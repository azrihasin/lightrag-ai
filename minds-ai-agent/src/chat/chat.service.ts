import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { convertMastraChunkToAISDKv5, convertFullStreamChunkToUIMessageStream } from '@mastra/core/stream';
import type { MastraMessageContentV2 } from '@mastra/core/agent';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { MindsAgentService } from './agent/minds-agent.service';
import { AnalyticsAgentService } from '../analytics/analytics-agent.service';
import { TextToVizWorkflow } from '../analytics/text-to-viz.workflow';
import type { ReexecuteResult } from '../analytics/text-to-viz.workflow';
import { analyticsRunStore } from '../analytics/analytics-run.store';
import { createRunContext } from '../analytics/analytics.types';
import {
  formatReasoningStep,
  renderReasoningMarkdown,
  resolveStepKey,
  type ReasoningStepDisplay,
  type ReasoningStepOutput,
  type RecoveryContext,
} from '../analytics/reasoning-format';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { WorkflowOutput, AnalyticsRunContext, VisualizationSpec } from '../analytics/analytics.types';

// Chunk types that convertFullStreamChunkToUIMessageStream can handle.
const UI_PASSTHROUGH_TYPES = new Set([
  'text-start', 'text-delta', 'text-end',
  'tool-call', 'tool-result', 'tool-call-delta', 'tool-call-input-streaming-start',
  'reasoning-start', 'reasoning-delta', 'reasoning-end',
  'source', 'file', 'finish', 'error',
]);

// ─── Thread history types ─────────────────────────────────────────────────────

export interface MastraThreadSummary {
  id: string;
  resourceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MastraMessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolInvocation?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MastraMessageDto {
  id: string;
  threadId: string;
  resourceId?: string;
  role: string;
  type: string;
  createdAt: Date;
  parts: MastraMessagePart[];
  metadata?: Record<string, unknown>;
}

interface StreamContext {
  threadId: string;
  resourceId: string;
  userText: string;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectPinoLogger(ChatService.name) private readonly logger: PinoLogger,
    private readonly mindsAgent: MindsAgentService,
    private readonly analyticsAgentService: AnalyticsAgentService,
    private readonly workflow: TextToVizWorkflow,
  ) {}

  // ── Thread history ──────────────────────────────────────────────────────────

  async listThreads(resourceId: string, limit = 50): Promise<MastraThreadSummary[]> {
    const result = await this.mindsAgent.store.memoryStorage.listThreads({
      filter: { resourceId },
      perPage: limit,
      page: 0,
      orderBy: { field: 'updatedAt', direction: 'DESC' },
    });
    return result.threads.map(t => ({
      id: t.id,
      resourceId: t.resourceId,
      title: t.title ?? '',
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      metadata: t.metadata ?? undefined,
    }));
  }

  /**
   * Hard-delete a thread (and all its messages) after verifying it belongs to
   * the given resource. Returns false when the thread does not exist for the
   * resource so the controller can surface a 404.
   */
  async deleteThread(threadId: string, resourceId: string): Promise<boolean> {
    const thread = await this.mindsAgent.store.memoryStorage.getThreadById({ threadId, resourceId });
    if (!thread || thread.resourceId !== resourceId) return false;

    await this.mindsAgent.store.memoryStorage.deleteThread({ threadId });
    this.logger.info({ threadId, resourceId }, 'Thread hard-deleted');
    return true;
  }

  async getThreadMessages(threadId: string, resourceId: string): Promise<MastraMessageDto[]> {
    const thread = await this.mindsAgent.store.memoryStorage.getThreadById({ threadId, resourceId });
    if (!thread) return [];

    const result = await this.mindsAgent.store.memoryStorage.listMessages({
      threadId,
      resourceId,
      perPage: false,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    });

    return result.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const content = m.content as MastraMessageContentV2 | unknown;
        let parts: MastraMessagePart[];
        let contentMetadata: Record<string, unknown> | undefined;

        if (
          content !== null &&
          typeof content === 'object' &&
          'format' in (content as object) &&
          (content as Record<string, unknown>)['format'] === 2 &&
          Array.isArray((content as Record<string, unknown>)['parts'])
        ) {
          // Standard V2 format: { format: 2, parts: [...], metadata?: {...} }
          const v2 = content as MastraMessageContentV2;
          parts = v2.parts as MastraMessagePart[];
          contentMetadata = v2.metadata ?? undefined;
        } else if (Array.isArray(content)) {
          // Legacy array format stored by older code
          parts = content as MastraMessagePart[];
        } else {
          parts = [{ type: 'text', text: typeof content === 'string' ? content : '' }];
        }

        return {
          id: m.id,
          threadId: m.threadId ?? threadId,
          resourceId: m.resourceId ?? undefined,
          role: m.role,
          type: (m.type as string | undefined) ?? 'text',
          createdAt: m.createdAt,
          parts,
          metadata: contentMetadata,
        };
      });
  }

  // ── Rerun a persisted query ───────────────────────────────────────────────
  //
  // Persisted assistant turns keep only the SQL + visualization *structure* — no
  // row data is stored (or ever sent to the LLM). The chat-history "rerun" card
  // calls this to regenerate the table + chart from a fresh, server-side query.

  async rerunMessage(
    threadId: string,
    messageId: string,
    resourceId: string,
  ): Promise<ReexecuteResult> {
    const messages = await this.getThreadMessages(threadId, resourceId);
    const msg = messages.find(m => m.id === messageId && m.role === 'assistant');
    if (!msg) {
      throw new NotFoundException(`Message ${messageId} not found in thread ${threadId}`);
    }

    const sql = msg.metadata?.['sql'];
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new BadRequestException('This message has no SQL query to re-run');
    }

    const spec = msg.metadata?.['visualizationSpec'] as VisualizationSpec | undefined;
    this.logger.info({ threadId, messageId }, 'Re-running persisted query');
    return this.workflow.reexecute(sql, spec);
  }

  // ── Stream entry points ─────────────────────────────────────────────────────

  /**
   * General chat assistant. Routes to the master multi-agent network: the
   * `analyticsMaster` supervisor delegates to its 7 subagents in order
   * (analyze_intent → retrieve_context → generate_sql → validate_sql →
   * execute_sql → summarize_result → generate_visualization). The new LightRAG
   * pieces are folded into the network — retrieve_context pulls structured schema
   * from LightRAG's `/query/data` endpoint, and generate_sql writes its query
   * with the Enterprise Text-to-SQL procedure — so the turn produces a grounded,
   * executed result with a data table and chart, not just SQL text.
   */
  stream(dto: ChatRequestDto, res: Response): void {
    const ctx = this.resolveStreamContext(dto);
    this.logger.info({ threadId: ctx.threadId, resourceId: ctx.resourceId }, 'Chat stream started');

    const signal = this.abortOnDisconnect(res, ctx.threadId);
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => this.runAgentStream(writer, ctx, signal),
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }

  /** Analytics page. Always routes directly to the text-to-viz workflow. */
  analyticsStream(dto: ChatRequestDto, res: Response): void {
    const ctx = this.resolveStreamContext(dto);
    this.logger.info({ threadId: ctx.threadId, resourceId: ctx.resourceId }, 'Analytics stream started');

    const signal = this.abortOnDisconnect(res, ctx.threadId);
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => this.runWorkflowStream(writer, ctx, signal),
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }

  /**
   * Bridge the HTTP connection lifecycle to an AbortSignal. When the client
   * presses Stop, the browser aborts the fetch and the socket closes before the
   * response has finished — that fires `res`'s `close` event with
   * `writableEnded === false`. We abort the controller then, which propagates
   * down to the agent loop and the in-flight LightRAG fetch so all backend work
   * (and its cost) stops immediately. A normal completion ends the response
   * first, so the `writableEnded` guard prevents a false abort.
   */
  private abortOnDisconnect(res: Response, threadId: string): AbortSignal {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded && !controller.signal.aborted) {
        this.logger.info({ threadId }, 'Client disconnected — aborting agent run');
        controller.abort();
      }
    });
    return controller.signal;
  }

  // ── Shared setup ────────────────────────────────────────────────────────────

  private resolveStreamContext(dto: ChatRequestDto): StreamContext {
    // Prefer the explicit threadId from the frontend. Fall back to `id`/`sessionId`,
    // but never trust the AI SDK transport's hardcoded "DEFAULT_THREAD_ID" — using it
    // would collapse every conversation into one thread and break history on refresh.
    const candidate = dto.threadId ?? dto.id ?? dto.sessionId;
    const threadId =
      candidate && candidate !== 'DEFAULT_THREAD_ID' ? candidate : randomUUID();

    return {
      threadId,
      resourceId: dto.resourceId ?? 'anonymous',
      userText: [...dto.messages].reverse().find(m => m.role === 'user')?.content ?? '',
    };
  }

  // ── Workflow path (analytics page → text-to-viz) ────────────────────────────

  private async runWorkflowStream(
    writer: any,
    ctx: StreamContext,
    signal: AbortSignal,
  ): Promise<void> {
    const { userText, threadId, resourceId } = ctx;

    try {
      const result = await this.workflow.run(userText, undefined, signal);

      const columnNames = result.columns.map(c => c.name);
      writer.write({ type: 'sql-table-start', toolCallId: threadId, columns: columnNames });
      for (const row of result.rows) {
        writer.write({ type: 'sql-table-row', toolCallId: threadId, row });
      }
      writer.write({ type: 'sql-table-end', toolCallId: threadId, rowCount: result.metadata.rowCount });

      writer.write({
        type: 'data-spec',
        data: {
          componentType: 'json-render',
          props: {
            spec: result.visualizationSpec,
            dataState: { rows: result.rows },
          },
        },
      });

      const textId = randomUUID();
      writer.write({ type: 'text-start', id: textId });
      writer.write({ type: 'text-delta', id: textId, delta: result.answer });
      writer.write({ type: 'text-end', id: textId });

      await this.saveWorkflowMessages(threadId, resourceId, userText, result);
    } catch (err) {
      // Client stopped mid-run: the connection is gone, so don't try to write an
      // error chunk — just stop quietly. The work has already been aborted.
      if (signal.aborted) {
        this.logger.info({ threadId }, 'textToVizWorkflow aborted by client stop');
        return;
      }
      const message = err instanceof Error ? err.message : 'Analytics pipeline error';
      this.logger.error({ threadId, err }, 'textToVizWorkflow error');
      writer.write({ type: 'error', errorText: message });
    }
  }

  private async saveWorkflowMessages(
    threadId: string,
    resourceId: string,
    userText: string,
    result: WorkflowOutput,
  ): Promise<void> {
    const storage = this.mindsAgent.store.memoryStorage;
    const now = new Date();

    const existing = await storage.getThreadById({ threadId, resourceId });
    await storage.saveThread({
      thread: {
        id: threadId,
        resourceId,
        title: existing?.title || userText.slice(0, 80),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        metadata: existing?.metadata ?? undefined,
      },
    });

    const userContent: MastraMessageContentV2 = {
      format: 2,
      parts: [{ type: 'text', text: userText }],
    };

    const assistantContent: MastraMessageContentV2 = {
      format: 2,
      parts: [{ type: 'text', text: result.answer }],
      metadata: {
        workflow: 'text-to-viz',
        sql: result.sql,
        columns: result.columns,
        rowCount: result.metadata.rowCount,
        visualizationSpec: result.visualizationSpec,
      },
    };

    await storage.saveMessages({
      messages: [
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'user',
          type: 'text',
          createdAt: new Date(now.getTime() - 1),
          content: userContent,
        },
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'assistant',
          type: 'text',
          createdAt: now,
          content: assistantContent,
        },
      ],
    });
  }

  // ── Agent path (general chat → master multi-agent network) ──────────────────
  //
  // The master agent (analyticsMaster) delegates to 7 subagents exposed as
  // `agent-<id>` tools. Each subagent's call shows as a reasoning block (opens
  // on the tool-call = "starting", fills with the subagent's own text on the
  // tool-result = "done"). Real row data + the chosen visualization travel
  // out-of-band via the run blackboard (analyticsRunStore), and are emitted to
  // the UI after the stream as the SQL table + json-render spec. The whole turn
  // is persisted manually to MongoDB (the agent runs WITHOUT Mastra memory).

  private async runAgentStream(
    writer: any,
    ctx: StreamContext,
    signal: AbortSignal,
  ): Promise<void> {
    const { userText, threadId, resourceId } = ctx;

    const run = createRunContext();
    const reasoningParts: Array<{ key: string; text: string }> = [];
    // step key → the unique stream id of its currently-open reasoning block.
    const openBlocks = new Map<string, string>();
    // The most recent unresolved failure. While set, each following step is
    // worded as a recovery (a bridge) and a successful execute_sql clears it.
    let recovery: RecoveryContext | null = null;
    // LightRAG live-stream state. As the retrieve_context tool streams the raw
    // endpoint response, we open a ```json fence inside its reasoning block and
    // append each chunk. `lightragStreamed` records that this happened so the
    // block's close step does NOT re-emit the fence to the live UI (it is already
    // there); the persisted copy still carries it for history reload.
    let lightragFenceOpen = false;
    let lightragStreamed = false;
    let finalText = '';
    // Authoritative final answer, read from the master agent's aggregate output
    // after the stream completes. Used only as a fallback for the reconstructed
    // text below, since `agentResult.text` can resolve to a partial value.
    let aggregateText = '';
    // The master's true final answer, reconstructed from its streamed text
    // deltas. During the agent phase every master text delta is suppressed from
    // the UI, but we still accumulate them here. The buffer is reset on each
    // subagent call so pre-step and inter-step narration is discarded — whatever
    // remains after the last subagent finishes is the genuine final answer. This
    // is more reliable than `agentResult.text`, which can come back clipped.
    let masterFinalText = '';
    const renderId = randomUUID();
    // Once the first subagent call is seen, ALL master-agent text is suppressed
    // during streaming — both pre-step narration ("Step 1: Analyze Intent") and
    // inter-step narration leaks to the UI otherwise. After the stream we emit
    // the authoritative final text (aggregateText) as a single block instead.
    let seenAgentCall = false;

    try {
      const agent = this.analyticsAgentService.getAgent();

      // Live sink: the retrieve_context tool streams the raw LightRAG response
      // here chunk-by-chunk. We append each chunk into a ```json fence inside the
      // step's open reasoning block so the user watches the endpoint response
      // build live, then close the fence when the stream ends.
      run.onLightragChunk = (delta: string) => {
        const id = openBlocks.get('retrieve_context');
        if (!id) return; // block not open yet — fall back to the close-step fence
        lightragStreamed = true;
        let out = delta;
        if (!lightragFenceOpen) {
          lightragFenceOpen = true;
          out = `\n\n\`\`\`json\n${delta}`;
        }
        writer.write({ type: 'reasoning-delta', id, delta: out });
      };
      run.onLightragEnd = () => {
        if (!lightragFenceOpen) return;
        const id = openBlocks.get('retrieve_context');
        if (id) writer.write({ type: 'reasoning-delta', id, delta: '\n```' });
        lightragFenceOpen = false;
      };

      // Run the whole stream consumption inside the blackboard context so every
      // subagent tool invocation shares this run's AnalyticsRunContext.
      await analyticsRunStore.run(run, async () => {
        // Pass the abort signal so a client Stop tears down the agent loop: the
        // master agent stops delegating, and the in-flight LightRAG fetch aborts.
        const agentResult = await agent.stream(userText, { maxSteps: 40, abortSignal: signal });

        for await (const rawChunk of agentResult.fullStream) {
          if (!rawChunk || typeof rawChunk !== 'object') continue;
          const chunk = rawChunk as Record<string, unknown>;
          const type = chunk['type'] as string | undefined;
          const payload = (chunk['payload'] as Record<string, unknown>) ?? {};
          const toolName = payload['toolName'] as string | undefined;

          // Subagent call lifecycle → one reasoning block per subagent.
          if (type === 'tool-call' && toolName?.startsWith('agent-')) {
            seenAgentCall = true;
            this.openReasoning(writer, toolName.slice('agent-'.length), openBlocks, recovery);
            continue;
          }
          if (type === 'tool-result' && toolName?.startsWith('agent-')) {
            // Everything streamed up to and including this subagent was narration
            // (the master's own or the subagent's, both surface as text-delta).
            // Drop it so the buffer only holds text emitted AFTER the last
            // subagent finishes — i.e. the master's genuine final answer.
            masterFinalText = '';
            const key = toolName.slice('agent-'.length);
            const isError = Boolean(payload['isError']);
            const resultText = this.extractSubagentText(payload['result']);
            const display = formatReasoningStep({
              stepName: key,
              status: isError ? 'error' : 'complete',
              output: this.buildStepOutput(key, run),
              result: resultText,
              error: isError ? resultText : undefined,
              recovery,
            });
            recovery = this.nextRecovery(recovery, resolveStepKey(key), display);
            this.closeReasoning(writer, key, display, openBlocks, reasoningParts, run, lightragStreamed);
            continue;
          }

          // Drop every other tool chunk (internal subagent tools like run_sql).
          if (type?.startsWith('tool-')) continue;

          // Suppress ALL master-agent text from the live UI during the agent
          // phase (pre-step, inter-step, and subagent narration all leak as
          // text-delta), but keep accumulating it into masterFinalText. After
          // the last subagent completes, whatever remains is the genuine final
          // answer, emitted as a single block after the reasoning blocks.
          if (
            seenAgentCall &&
            (type === 'text-delta' || type === 'text-start' || type === 'text-end')
          ) {
            if (type === 'text-delta') {
              masterFinalText += ((payload['text'] ?? payload['delta'] ?? '') as string);
            }
            continue;
          }

          const part = convertMastraChunkToAISDKv5({ chunk: rawChunk as any });
          if (!part) continue;
          const partType = (part as Record<string, unknown>)['type'] as string | undefined;
          if (!partType || !UI_PASSTHROUGH_TYPES.has(partType)) continue;
          if (partType.startsWith('tool-')) continue;

          if (partType === 'text-delta') {
            const pp = part as Record<string, unknown>;
            finalText += ((pp['delta'] ?? pp['text'] ?? '') as string);
          }

          const uiChunk = convertFullStreamChunkToUIMessageStream({
            part: part as any,
            onError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
            sendStart: false,
            sendFinish: false,
          });
          if (uiChunk) writer.write(uiChunk);
        }

        // Aggregate text is the master agent's full answer (intro + narration +
        // final response). Used as the source of truth for persistence below.
        try {
          const t: unknown = (agentResult as { text?: unknown }).text;
          const resolved = typeof t === 'string' ? t : await t;
          if (typeof resolved === 'string' && resolved.trim()) {
            aggregateText = resolved.trim();
          }
        } catch {
          // aggregate text unavailable — fall back to the chunk accumulator
        }
      });

      // Client stopped: the stream may have ended early without throwing. Bail
      // before finalizing/persisting a half-finished turn — the connection is
      // gone and the backend work has already been aborted.
      if (signal.aborted) {
        this.logger.info({ threadId }, 'Agent stream aborted by client stop');
        return;
      }

      // During the agent phase all streaming text was suppressed, so finalText
      // will be empty. Prefer the text reconstructed from the master's own deltas
      // (the answer emitted after the last subagent), falling back to the
      // aggregate text only if reconstruction came back empty.
      if (seenAgentCall) {
        finalText = masterFinalText.trim() || aggregateText.trim();
      } else if (!finalText.trim() && aggregateText) {
        // Non-agent path: per-chunk accumulator missed some deltas; use aggregate.
        finalText = aggregateText;
      }

      // Safety: close any reasoning block that opened but never got a result.
      // Finalize with a truthful outcome derived from whatever the blackboard holds.
      for (const [key, id] of openBlocks) {
        const display = formatReasoningStep({
          stepName: key,
          status: 'complete',
          output: this.buildStepOutput(key, run),
          recovery,
        });
        recovery = this.nextRecovery(recovery, resolveStepKey(key), display);
        const metricsMd = this.lightragMetricsComment(key, run);
        const persistMd =
          renderReasoningMarkdown(display) +
          this.retrievedContextBlock(key, run) +
          this.generatedSqlBlock(key, run) +
          metricsMd;
        // Skip re-emitting the fence to the live UI when it was already streamed
        // in (see closeReasoning); the persisted copy keeps it for reload.
        const liveMd =
          lightragStreamed && resolveStepKey(key) === 'retrieve_context'
            ? renderReasoningMarkdown(display) + metricsMd
            : persistMd;
        writer.write({ type: 'reasoning-delta', id, delta: `\n\n${liveMd}` });
        writer.write({ type: 'reasoning-end', id });
        reasoningParts.push({ key, text: persistMd });
      }

      // Emit the SQL table + visualization from the blackboard. The data table
      // renders whenever there are rows; the chart spec is optional (a flat list
      // is shown as a table only, with no forced chart).
      // A coverage/congestion map sets run.spec with no SQL rows, so emit when
      // there are rows OR a spec to render.
      const hasData = run.columns.length > 0;
      const hasRender = hasData || Boolean(run.spec);
      if (hasRender) this.emitRender(writer, renderId, run);

      // For the agent phase the final text was suppressed during streaming —
      // emit it now as a single block after all reasoning blocks and data renders.
      if (seenAgentCall && finalText.trim()) {
        const textId = randomUUID();
        writer.write({ type: 'text-start', id: textId });
        writer.write({ type: 'text-delta', id: textId, delta: finalText });
        writer.write({ type: 'text-end', id: textId });
      }

      // Never leave the bubble empty.
      if (!finalText.trim()) {
        finalText =
          run.rowCount > 0
            ? `Returned ${run.rowCount} row${run.rowCount === 1 ? '' : 's'}. See the table and chart below.`
            : 'No matching data was found for your question.';
        const textId = randomUUID();
        writer.write({ type: 'text-start', id: textId });
        writer.write({ type: 'text-delta', id: textId, delta: finalText });
        writer.write({ type: 'text-end', id: textId });
      }

      this.logger.info({ threadId, hasData, steps: reasoningParts.length }, 'Agent stream completed');

      await this.saveAgentTurn(threadId, resourceId, userText, {
        reasoningParts,
        finalText,
        run: hasRender ? run : undefined,
        renderId,
      });
    } catch (err) {
      // A client Stop aborts the agent loop, which surfaces here as an
      // AbortError. That's expected teardown, not a failure: stay quiet (the
      // connection is closed) and don't persist the partial turn.
      if (signal.aborted) {
        this.logger.info({ threadId }, 'Agent stream aborted by client stop');
        return;
      }
      const message = err instanceof Error ? err.message : 'Agent error';
      this.logger.error({ threadId, err }, 'Agent stream error');
      writer.write({ type: 'error', errorText: message });
    }
  }

  /**
   * Open a reasoning block for a subagent (the "starting" moment). Streams the
   * active-progress title (e.g. "Running the database query") as a `### heading`.
   */
  private openReasoning(
    writer: any,
    key: string,
    openBlocks: Map<string, string>,
    recovery: RecoveryContext | null,
  ): void {
    if (openBlocks.has(key)) return;
    // Unique per attempt: a step can run more than once (a retry after a failure),
    // and reusing a closed block's id would collide with the earlier attempt.
    const id = `reasoning-${key}-${randomUUID()}`;
    const display = formatReasoningStep({ stepName: key, status: 'running', recovery });
    writer.write({ type: 'reasoning-start', id });
    writer.write({ type: 'reasoning-delta', id, delta: `### ${display.title}` });
    openBlocks.set(key, id);
  }

  /**
   * Advance the run's recovery state after a step's outcome is known.
   *   • A failed step opens a recovery (the next steps become its bridge).
   *   • A successful execute_sql closes the recovery (the retry succeeded).
   *   • Any other successful step while recovering marks the bridge as announced
   *     so the failure is named once, not replayed on every following block.
   */
  private nextRecovery(
    recovery: RecoveryContext | null,
    key: ReturnType<typeof resolveStepKey>,
    display: ReasoningStepDisplay,
  ): RecoveryContext | null {
    if (display.failed) return { failedStepKey: key, announced: false };
    if (!recovery) return null;
    if (key === 'execute_sql') return null;
    return recovery.announced ? recovery : { ...recovery, announced: true };
  }

  /**
   * Fill + close a subagent's reasoning block (the "done" moment). Appends the
   * outcome title + body as a fresh `### heading`; the frontend shows the latest
   * heading, so the active title is superseded by the outcome. Only the outcome
   * (a single heading) is persisted.
   */
  private closeReasoning(
    writer: any,
    key: string,
    display: ReasoningStepDisplay,
    openBlocks: Map<string, string>,
    reasoningParts: Array<{ key: string; text: string }>,
    run: AnalyticsRunContext,
    lightragStreamed: boolean,
  ): void {
    if (!openBlocks.has(key)) this.openReasoning(writer, key, openBlocks, null);
    const id = openBlocks.get(key) ?? `reasoning-${key}`;
    // Invisible token/timing metrics carried in both the live and persisted copy
    // (retrieve_context only) so the message-timing badge renders during the
    // stream and again on history reload.
    const metricsMd = this.lightragMetricsComment(key, run);
    // The persisted copy always carries the raw LightRAG JSON (retrieve_context
    // only) and the generated SQL (generate_sql only) as fenced codeblocks so a
    // history reload renders them.
    const persistMd =
      renderReasoningMarkdown(display) +
      this.retrievedContextBlock(key, run) +
      this.generatedSqlBlock(key, run) +
      metricsMd;
    // When the response was already streamed live into this block as a codeblock,
    // the live UI only needs the outcome heading + body now — re-emitting the
    // fence would duplicate it. The frontend lifts the codeblock out of the full
    // block text, so its position (streamed earlier vs. appended) does not matter.
    const liveMd =
      lightragStreamed && resolveStepKey(key) === 'retrieve_context'
        ? renderReasoningMarkdown(display) + metricsMd
        : persistMd;
    writer.write({ type: 'reasoning-delta', id, delta: `\n\n${liveMd}` });
    writer.write({ type: 'reasoning-end', id });
    reasoningParts.push({ key, text: persistMd });
    openBlocks.delete(key);
  }

  /**
   * For the retrieve_context step, render the raw LightRAG schema JSON as a
   * fenced ```json block to append to the reasoning block body. The UI shows it
   * as a codeblock beneath the table-name badges. Pretty-prints when the context
   * parses as JSON; otherwise emits the raw text verbatim. Returns '' for other
   * steps or when nothing was retrieved.
   */
  private retrievedContextBlock(key: string, run: AnalyticsRunContext): string {
    if (resolveStepKey(key) !== 'retrieve_context') return '';
    const context = run.retrievedContext?.trim();
    if (!context) return '';
    let body = context;
    try {
      body = JSON.stringify(JSON.parse(context), null, 2);
    } catch {
      // Not JSON — show the raw retrieved text as-is.
    }
    return `\n\n\`\`\`json\n${body}\n\`\`\``;
  }

  /**
   * For the generate_sql step, render the SQL recorded on the run blackboard as a
   * fenced ```sql block appended to the reasoning block body. The UI lifts it out
   * and renders it as a codeblock (see frontend GhostReasoning), so the user sees
   * the exact query that was prepared. Returns '' for other steps or when no SQL
   * was recorded (e.g. a context gap where the step recorded an empty query).
   */
  private generatedSqlBlock(key: string, run: AnalyticsRunContext): string {
    if (resolveStepKey(key) !== 'generate_sql') return '';
    const sql = run.sql?.trim();
    if (!sql) return '';
    return `\n\n\`\`\`sql\n${sql}\n\`\`\``;
  }

  /**
   * Encode the LightRAG token/timing metrics (retrieve_context only) as an
   * invisible HTML comment appended to the reasoning block. ReactMarkdown ignores
   * it; the frontend parses the comment out and renders a message-timing-style
   * badge showing the input/output token estimate and call timing. Returns '' for
   * other steps or when no metrics were recorded.
   */
  private lightragMetricsComment(key: string, run: AnalyticsRunContext): string {
    if (resolveStepKey(key) !== 'retrieve_context') return '';
    const metrics = run.lightragMetrics;
    if (!metrics) return '';
    return `\n\n<!--lightrag-timing:${JSON.stringify(metrics)}-->`;
  }

  /** Collect a step's exact, structured outcome metadata from the run blackboard. */
  private buildStepOutput(key: string, run: AnalyticsRunContext): ReasoningStepOutput {
    switch (key) {
      case 'retrieve_context':
        return { referenceCount: run.contextReferences?.length };
      case 'generate_sql':
        return { sql: run.sql };
      case 'validate_sql':
        return { valid: run.sqlValid };
      case 'execute_sql': {
        const limit = Number(run.sql?.match(/\blimit\s+(\d+)/i)?.[1]) || undefined;
        return { rowCount: run.rowCount, columnCount: run.columns.length, limit };
      }
      case 'generate_visualization':
        // vizChoice is set even when a table was chosen (no chart spec).
        return { componentType: run.spec?.componentType ?? run.vizChoice };
      case 'render_coverage_map':
        return { componentType: run.spec?.componentType ?? 'GeoMap' };
      default:
        return {};
    }
  }

  /** Best-effort extraction of a subagent's text from its tool-result payload. */
  private extractSubagentText(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r['text'] === 'string') return r['text'] as string;
      if (typeof r['answer'] === 'string') return r['answer'] as string;
      try {
        return JSON.stringify(result).slice(0, 2000);
      } catch {
        return '';
      }
    }
    return '';
  }

  /** Emit the SQL table (streamed rows) + json-render visualization spec. */
  private emitRender(writer: any, renderId: string, run: AnalyticsRunContext): void {
    const columnNames = run.columns.map((c) => c.name);

    // The SQL data table only when the run actually produced rows/columns. A
    // coverage-map turn has a spec but no tabular data — skip the empty table.
    if (columnNames.length > 0) {
      writer.write({
        type: 'data-sql-table',
        data: { runId: renderId, columns: columnNames, rowCount: run.rowCount },
      });
      writer.write({ type: 'sql-table-start', toolCallId: renderId, columns: columnNames });
      for (const row of run.rows) {
        writer.write({ type: 'sql-table-row', toolCallId: renderId, row });
      }
      writer.write({ type: 'sql-table-end', toolCallId: renderId, rowCount: run.rowCount });
    }

    if (run.spec) {
      // ChatPage maps `{ componentType, props }` → json-render node `{ type, props }`.
      writer.write({
        type: 'data-spec',
        data: { componentType: run.spec.componentType, props: run.spec.props },
      });
    }
  }

  /**
   * Drop raw row data from a visualization spec, keeping only its structure
   * (component type + axis/column mappings). Persisted specs must never carry
   * database rows; they are re-hydrated on demand via {@link rerunMessage}.
   */
  private stripSpecData(spec: VisualizationSpec): VisualizationSpec {
    const props: Record<string, unknown> = { ...(spec.props ?? {}) };
    // Coverage/congestion maps carry no database rows — only static PMTiles URLs
    // + viewport. The persisted spec is self-contained and re-renders directly on
    // history reload (there is no SQL to rerun), so keep center + pmtiles intact.
    if (spec.componentType === 'GeoMap' && props.pmtiles) {
      return { componentType: spec.componentType, props };
    }
    delete props.data;
    delete props.center;
    if (props.dataState && typeof props.dataState === 'object') {
      const ds = { ...(props.dataState as Record<string, unknown>) };
      delete ds.rows;
      props.dataState = ds;
    }
    return { componentType: spec.componentType, props };
  }

  /**
   * Persist a chat-path turn manually to MongoDB: the user message + an
   * assistant message carrying every subagent's reasoning block, a
   * render_visualization part (so the chart reloads), and the final text.
   */
  private async saveAgentTurn(
    threadId: string,
    resourceId: string,
    userText: string,
    data: {
      reasoningParts: Array<{ key: string; text: string }>;
      finalText: string;
      run?: AnalyticsRunContext;
      renderId: string;
    },
  ): Promise<void> {
    const storage = this.mindsAgent.store.memoryStorage;
    const now = new Date();

    const existing = await storage.getThreadById({ threadId, resourceId });
    await storage.saveThread({
      thread: {
        id: threadId,
        resourceId,
        title: existing?.title || userText.slice(0, 80) || 'New Chat',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        metadata: existing?.metadata ?? undefined,
      },
    });

    const assistantParts: MastraMessagePart[] = data.reasoningParts.map((r) => ({
      type: 'reasoning',
      reasoning: r.text,
    }));

    // Persist only the visualization STRUCTURE (component + axis mappings). The
    // actual row data is intentionally dropped — it is regenerated on demand via
    // the rerun card so database data is never stored at rest.
    const safeSpec = data.run?.spec ? this.stripSpecData(data.run.spec) : undefined;

    if (safeSpec) {
      assistantParts.push({
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: data.renderId,
          toolName: 'render_visualization',
          args: {},
          state: 'output-available',
          result: JSON.stringify({ dataSpec: safeSpec }),
        },
      });
    }

    assistantParts.push({ type: 'text', text: data.finalText });

    const userContent: MastraMessageContentV2 = {
      format: 2,
      parts: [{ type: 'text', text: userText }],
    };

    const assistantContent: MastraMessageContentV2 = {
      format: 2,
      parts: assistantParts as MastraMessageContentV2['parts'],
      metadata: data.run
        ? {
            workflow: 'analytics-network',
            sql: data.run.sql,
            columns: data.run.columns,
            rowCount: data.run.rowCount,
            visualizationSpec: safeSpec,
          }
        : { workflow: 'analytics-network' },
    };

    await storage.saveMessages({
      messages: [
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'user',
          type: 'text',
          createdAt: new Date(now.getTime() - 1),
          content: userContent,
        },
        {
          id: randomUUID(),
          threadId,
          resourceId,
          role: 'assistant',
          type: 'text',
          createdAt: now,
          content: assistantContent,
        },
      ],
    });
  }
}
