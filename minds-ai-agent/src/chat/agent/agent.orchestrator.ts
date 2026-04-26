import { Injectable } from '@nestjs/common';
import {
  streamText,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  stepCountIs,
} from 'ai';
import type { Response } from 'express';
import { ToolRegistry } from '../tools/tool-registry';
import { ModelProvider } from '../providers/model.provider';
import { UiDiscoveryService } from '../discovery/ui-discovery.service';
import type { ChatRequestDto } from '../dto/chat-request.dto';
import type { DataSpecPayload } from '../dto/sse-event.dto';
import {
  createInitialState,
  type AgentState,
  type Action,
  type ExecutionResult,
  type ValidationResult,
} from './agent.state';

const MAX_STEPS = 12;

const SYSTEM_PROMPT = `You are a precise AI agent. Follow this pipeline strictly for every request:

PIPELINE ORDER:
1. Call retrieve_context (always first — never skip this)
2. If retrieved context is sufficient: call answer_from_context → STOP
3. If query is ambiguous and you cannot proceed: call clarification_request → STOP
4. Decide path:
   - Data query (needs a database): generate_sql → validate_sql → execute_sql
   - Calculation/search/data-gen: generate_action → validate_action → execute_system_action
5. If validate_sql or validate_action returns "invalid_recoverable": regenerate (max 2 retries per action)
6. If validate returns "invalid_blocking" or riskLevel is "high": call human_review_gate → STOP
7. Call inspect_result on the execution output
8. If inspect_result.complete is false and steps remain: loop back to step 4 with refined intent
9. Call prepare_visualization_data if result has rows or numeric data
10. If prepare_visualization_data.suitable is true: call render_visualization
11. If not suitable: call summarize_result
12. Call compose_final_response → STOP

RULES:
- ALWAYS start with retrieve_context
- NEVER call execute_sql without a preceding validate_sql with status "valid"
- NEVER call execute_system_action without a preceding validate_action with status "valid"
- Keep internal reasoning private; stream only safe, user-facing content`;

type CoreMsg = { role: 'user' | 'assistant' | 'system'; content: string };

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly uiDiscovery: UiDiscoveryService,
  ) {}

  run(dto: ChatRequestDto, enableUiDiscovery: boolean, res: Response): void {
    const state = createInitialState(dto.messages);
    const model = this.modelProvider.getModel();
    const tools = this.toolRegistry.getAll();

    const messages: CoreMsg[] = dto.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    let uiWriter: { write: (part: unknown) => void } | null = null;

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: ({ toolResults }) => {
        if (!toolResults?.length) return;

        state.stepCount++;

        for (const tr of toolResults as Array<{
          toolCallId: string;
          toolName: string;
          result?: unknown;
          output?: unknown;
        }>) {
          const raw = ((tr.result ?? tr.output) ?? {}) as Record<string, unknown>;
          this.applyToolResultToState(tr.toolName, raw, state);

          if (enableUiDiscovery && uiWriter) {
            this.maybeEmitDataSpec(tr.toolName, raw, uiWriter);
          }
        }
      },
    });

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        uiWriter = writer as unknown as { write: (part: unknown) => void };
        (writer as unknown as { merge: (s: unknown) => void }).merge(result.toUIMessageStream());
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream });
  }

  // ── state mutation ──────────────────────────────────────────────────────────

  private applyToolResultToState(
    toolName: string,
    output: Record<string, unknown>,
    state: AgentState,
  ): void {
    switch (toolName) {
      case 'retrieve_context':
        state.retrievedContext = {
          documents: (output.documents as unknown[]) ?? [],
          query: String(output.query ?? ''),
          sufficient: Boolean(output.sufficient),
          contextSummary: output.contextSummary as string | undefined,
        };
        break;

      case 'answer_from_context':
        state.directAnswerEligible = true;
        state.finalResponseDraft = String(output.answer ?? '');
        state.terminalStatus = 'complete';
        break;

      case 'clarification_request':
        state.clarificationNeeded = true;
        state.terminalStatus = 'clarification_sent';
        break;

      case 'generate_sql':
      case 'generate_action': {
        const id = String(output.actionId ?? '');
        const prev = state.pendingAction?.id === id ? state.pendingAction : null;
        const action: Action = {
          id,
          type: toolName === 'generate_sql' ? 'sql' : 'system_tool',
          rationale: String(output.rationale ?? ''),
          input: { sql: output.sql, ...(output.input as object | undefined) },
          validationState: 'pending',
          executionState: 'pending',
          resultSummary: null,
          retryCount: prev ? prev.retryCount + 1 : 0,
        };
        state.pendingAction = action;
        break;
      }

      case 'validate_sql':
      case 'validate_action': {
        const vr: ValidationResult = {
          actionId: String(output.actionId ?? ''),
          status: output.status as ValidationResult['status'],
          reason: output.reason as string | undefined,
        };
        state.validationResults.push(vr);
        if (state.pendingAction) state.pendingAction.validationState = vr.status;
        break;
      }

      case 'execute_sql':
      case 'execute_system_action': {
        const er: ExecutionResult = {
          actionId: String(output.actionId ?? ''),
          success: Boolean(output.success),
          data: output.rows ?? output.result ?? output,
          error: output.error as string | undefined,
          durationMs: Number(output.durationMs ?? 0),
        };
        state.executionResults.push(er);
        if (state.pendingAction) {
          state.pendingAction.executionState = er.success ? 'success' : 'error';
          state.actionHistory.push({ ...state.pendingAction });
          state.pendingAction = null;
        }
        break;
      }

      case 'inspect_result':
        state.resultInspection = {
          complete: Boolean(output.complete),
          quality: output.quality as 'sufficient' | 'partial' | 'failed',
          summary: String(output.summary ?? ''),
          dataShape: output.dataShape as Record<string, unknown> | undefined,
        };
        break;

      case 'prepare_visualization_data':
        state.visualizationDecision = {
          suitable: Boolean(output.suitable),
          componentType: output.componentType as AgentState['visualizationDecision'] extends { componentType?: infer C } ? C : never,
        };
        if (output.suitable) {
          state.visualizationPayload = {
            componentType: output.componentType as NonNullable<AgentState['visualizationPayload']>['componentType'],
            props: (output.props as Record<string, unknown>) ?? {},
          };
        }
        break;

      case 'render_visualization': {
        const ds = output.dataSpec as DataSpecPayload;
        if (ds) {
          state.visualizationPayload = {
            componentType: ds.componentType,
            props: ds.props,
            patch: ds.patch as unknown[],
          };
        }
        break;
      }

      case 'human_review_gate':
        state.riskState = {
          level: output.riskLevel as 'medium' | 'high',
          reason: String(output.reason ?? ''),
        };
        state.reviewState = {
          needed: true,
          reason: String(output.reason ?? ''),
          pendingActionId: output.actionId as string | undefined,
        };
        state.terminalStatus = 'review_needed';
        break;

      case 'compose_final_response':
        state.finalResponseDraft = String(output.responseText ?? '');
        state.terminalStatus = 'complete';
        break;
    }
  }

  // ── visualization emission ──────────────────────────────────────────────────

  private maybeEmitDataSpec(
    toolName: string,
    output: Record<string, unknown>,
    writer: { write: (part: unknown) => void },
  ): void {
    let dataSpec: DataSpecPayload | null = null;

    if (toolName === 'render_visualization') {
      dataSpec = output.dataSpec as DataSpecPayload;
    } else if (
      toolName === 'execute_sql' ||
      toolName === 'execute_system_action' ||
      toolName === 'answer_from_context'
    ) {
      const sanitized = this.toolRegistry.sanitize(output);
      const discovery = this.uiDiscovery.inspect({
        toolName,
        toolCallId: '',
        output: sanitized,
        sanitized: true,
        durationMs: 0,
      });
      if (discovery) dataSpec = this.uiDiscovery.buildDataSpec(discovery);
    }

    if (dataSpec) {
      writer.write({
        type: 'data-spec',
        data: { componentType: dataSpec.componentType, props: dataSpec.props },
      });
    }
  }
}
