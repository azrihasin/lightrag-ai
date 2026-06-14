import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { encode } from 'gpt-tokenizer';
import { currentRun } from '../../../analytics/analytics-run.store';
import type { LightragMetrics } from '../../../analytics/analytics.types';

/**
 * Strict schema-formatter prompt handed to LightRAG's generation step. LightRAG
 * uses this prompt to turn the retrieved context into a constrained JSON schema
 * whitelist (exact table/column names only) — never prose, SQL, or explanations.
 */
// Kept deliberately short: every token here is paid on every LightRAG call.
// The only job is to make the LLM emit compact JSON and nothing else.
const SCHEMA_USER_PROMPT =
  'Output ONLY this JSON, no prose, no markdown, no reasoning: ' +
  '{"tables":[{"table":"exact_table_name","columns":["col1","col2"]}]}. ' +
  'Use only table and column names that appear verbatim in the retrieved context. ' +
  'Do not rename, infer, or invent any identifier. ' +
  'If context is insufficient return {"tables":[]}.';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TOP_K = 4;

/**
 * Token count via `gpt-tokenizer` (pure-JS BPE, cl100k_base). LightRAG's
 * `/query/stream` endpoint returns no usage figures, so we tokenize the input
 * (the query + schema prompt we send) and the output (the streamed response)
 * ourselves. Falls back to the ~4-chars/token heuristic if encoding ever throws.
 */
function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
// Max tokens of graph context assembled before being sent to LightRAG's LLM.
// Keeping this low is the primary lever for reducing input token cost while
// still using the knowledge graph and LLM generation step.
const MAX_LOCAL_CONTEXT_TOKENS = 2000;
const MAX_TEXT_UNIT_TOKENS = 512;
// Total token budget for the structured `/query/data` retrieval. LightRAG fills
// this budget in priority order — entities, then relations, then CHUNKS LAST — so
// a too-tight cap (e.g. the 2000 used for the streaming path) leaves nothing for
// chunks and they come back as `[]` even though the document chunks exist. Give
// enough headroom that the retrieved chunks actually survive into the response.
const MAX_TOTAL_CONTEXT_TOKENS = 8000;
// How many document chunks to pull from the vector store. Set explicitly because
// LightRAG can otherwise return zero chunks when only the KG side matched.
const DEFAULT_CHUNK_TOP_K = 8;

@Injectable()
export class LightragHarnessTool {
  constructor(
    @InjectPinoLogger(LightragHarnessTool.name) private readonly logger: PinoLogger,
  ) {}

  asTool() {
    return createTool({
      id: 'harness_retrieve_context',
      description:
        'Retrieve a database schema whitelist from LightRAG as compact JSON ' +
        '({ tables: [{ table, columns }] }) containing only exact table/column names. ' +
        'Downstream SQL generation must treat this JSON as the only allowed schema.',
      inputSchema: z.object({
        query: z.string().describe('Schema-oriented retrieval query derived from user intent'),
        mode: z
          .enum(['local', 'global', 'hybrid', 'naive', 'mix', 'bypass'])
          .optional()
          .default('local'),
        topK: z
          .number()
          .int()
          .min(1)
          .max(DEFAULT_TOP_K)
          .optional()
          .describe(
            `Entities/relations to retrieve from the knowledge graph; defaults to ${DEFAULT_TOP_K}. ` +
              `Capped at ${DEFAULT_TOP_K} — do NOT raise it on retry, it only increases cost.`,
          ),
      }),
      outputSchema: z.object({
        query: z.string(),
        /** The JSON schema string from LightRAG, passed as context to the SQL agent. */
        schemaJson: z.string(),
      }),
      execute: async (input, ctx?: { abortSignal?: AbortSignal }) => {
        const LIGHTRAG_URL = process.env.LIGHTRAG_API_URL ?? 'http://localhost:9621';
        const userSignal = ctx?.abortSignal;

        // If the user already stopped before this call even starts, do not hit
        // LightRAG at all — abort immediately so no request (and no cost) occurs.
        if (userSignal?.aborted) {
          throw userSignal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        // Clamp every request to the ceiling so a retry can never escalate top_k.
        const topK = Math.min(input.topK ?? DEFAULT_TOP_K, DEFAULT_TOP_K);
        this.logger.debug({ query: input.query, mode: input.mode, topK }, 'LightRAG schema retrieval');

        // Abort the in-flight HTTP request when EITHER the user stops the chat
        // (userSignal) OR the per-request timeout elapses. Tying the fetch to the
        // user signal is what actually stops LightRAG work the moment Stop is hit.
        const timeoutSignal = AbortSignal.timeout(this.resolveTimeout());
        const signal = userSignal
          ? AbortSignal.any([userSignal, timeoutSignal])
          : timeoutSignal;

        // Stream the response so its raw text builds live in the reasoning block.
        // When the chat agent path set a live sink on the blackboard, each chunk
        // is forwarded to it as it arrives; otherwise we just accumulate the full
        // response (the workflow path has no live reasoning UI).
        const run = currentRun();
        const sink = run?.onLightragChunk;

        // Token + timing accounting. The input we send to LightRAG is the query
        // plus the schema-formatter prompt; the output is whatever streams back.
        // LightRAG reports no usage, so both are tokenized client-side.
        const inputTokens = countTokens(`${input.query}\n${SCHEMA_USER_PROMPT}`);
        const startedAt = Date.now();

        try {
          // GUARDRAIL: only_need_context is intentionally FALSE so LightRAG's
          // generation step runs and formats the retrieved context into a compact
          // JSON schema whitelist (exact names only) via SCHEMA_USER_PROMPT.
          const res = await fetch(`${LIGHTRAG_URL}/query/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: input.query,
              mode: input.mode ?? 'local',
              only_need_context: false,
              // Cap how many tokens of graph context are assembled before being
              // sent to LightRAG's LLM — the primary lever for input token cost.
              max_token_for_local_context: MAX_LOCAL_CONTEXT_TOKENS,
              max_token_for_text_unit: MAX_TEXT_UNIT_TOKENS,
              top_k: topK,
              user_prompt: SCHEMA_USER_PROMPT,
              stream: true,
            }),
            signal,
          });

          if (!res.ok || !res.body) {
            this.logger.warn({ status: res.status }, 'LightRAG non-OK response');
            return this.emptySchema(input.query);
          }

          // /query/stream emits NDJSON lines: { response: "<delta>" } generation
          // chunks plus an optional { references: [...] } line. Concatenating the
          // response deltas yields the same compact JSON schema string the
          // non-streaming endpoint returned.
          const { response, references, firstChunkAt } = await this.consumeStream(res.body, sink);
          const schemaJson = response.trim() || '{"tables":[]}';

          // Record the schema on the run blackboard so the SQL agent and the
          // grounding guard see exactly this whitelist as the allowed schema.
          if (run) {
            run.retrievedContext = schemaJson;
            run.contextReferences = references;
            run.lightragMetrics = {
              inputTokens,
              outputTokens: countTokens(response),
              ttftMs: firstChunkAt ? firstChunkAt - startedAt : undefined,
              durationMs: Date.now() - startedAt,
            };
          }

          return { query: input.query, schemaJson };
        } catch (err) {
          // User pressed Stop: propagate the abort so the agent loop unwinds and
          // does NOT silently retry the retrieval (which would keep costing money).
          if (userSignal?.aborted) {
            this.logger.info('LightRAG retrieval aborted by user stop');
            throw err;
          }
          // Timeout or network failure: degrade to an empty schema so the agent
          // can report insufficient context rather than crash.
          this.logger.error({ err }, 'LightRAG request failed');
          return this.emptySchema(input.query);
        } finally {
          // Close the live code-block fence (if one was opened), whether the
          // stream completed, timed out, or failed — so the UI never gets stuck
          // with an unterminated block.
          run?.onLightragEnd?.();
        }
      },
    });
  }

  /**
   * Tool form of the structured `/query/data` retrieval, for the master network's
   * `retrieve_context` subagent. Unlike {@link asTool} (which drives the older
   * `/query/stream` generation path and returns a compact `{tables}` whitelist),
   * this calls {@link retrieve} to pull the richer structured payload (knowledge
   * graph entities, relationships and document chunks) and writes it to the run
   * blackboard so the downstream `generate_sql` grounding guard and the chat UI
   * (`retrievedContextBlock`, table-source chips, timing badge) all read the exact
   * same context. Defaults to `mix` mode like the standalone flow.
   */
  asDataTool() {
    return createTool({
      id: 'harness_retrieve_context',
      description:
        'Retrieve structured database schema context from LightRAG as JSON ' +
        '({ entities, relationships, chunks }) for the analyzed intent. Downstream SQL ' +
        'generation must treat the table/column names in this JSON as the only allowed schema.',
      inputSchema: z.object({
        query: z.string().describe('Schema-oriented retrieval query derived from user intent'),
        mode: z
          .enum(['local', 'global', 'hybrid', 'naive', 'mix', 'bypass'])
          .optional()
          .default('mix'),
        topK: z
          .number()
          .int()
          .min(1)
          .max(DEFAULT_TOP_K)
          .optional()
          .describe(
            `Entities/relations to retrieve from the knowledge graph; defaults to ${DEFAULT_TOP_K}. ` +
              `Capped at ${DEFAULT_TOP_K} — do NOT raise it on retry, it only increases cost.`,
          ),
      }),
      outputSchema: z.object({
        query: z.string(),
        /** The structured retrieval JSON string, passed as context to generate_sql. */
        schemaJson: z.string(),
      }),
      execute: async (input, ctx?: { abortSignal?: AbortSignal }) => {
        const { schemaJson, metrics } = await this.retrieve({
          query: input.query,
          mode: input.mode ?? 'mix',
          topK: input.topK,
          signal: ctx?.abortSignal,
        });

        // Record on the run blackboard so the SQL agent, the record_sql grounding
        // guard, and the chat UI all see exactly this context (mirrors asTool()).
        const run = currentRun();
        if (run) {
          run.retrievedContext = schemaJson;
          run.lightragMetrics = metrics;
        }

        return { query: input.query, schemaJson };
      },
    });
  }

  /**
   * Standalone retrieval against LightRAG's structured `/query/data` endpoint —
   * the first step of the 2-step LightRAG chat flow. Unlike {@link asTool} (which
   * drives the legacy `/query/stream` generation path), this returns the raw
   * structured retrieval payload (knowledge-graph entities, relationships and
   * document chunks) as a pretty-printed JSON string for the SQL agent to ingest.
   *
   * Per the flow's requirements: sends ONLY the latest user prompt (no
   * conversation history), uses `mix` mode, and omits references. The endpoint
   * returns a single JSON body (it does not stream), so there is no live token
   * sink here — the caller renders the returned JSON as a code block.
   */
  async retrieve(params: {
    query: string;
    mode?: 'local' | 'global' | 'hybrid' | 'naive' | 'mix' | 'bypass';
    topK?: number;
    signal?: AbortSignal;
  }): Promise<{ schemaJson: string; metrics: LightragMetrics }> {
    const LIGHTRAG_URL = process.env.LIGHTRAG_API_URL ?? 'http://localhost:9621';
    const { signal } = params;

    // If the user already stopped before this call starts, do not hit LightRAG.
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const mode = params.mode ?? 'mix';
    const topK = Math.min(params.topK ?? DEFAULT_TOP_K, DEFAULT_TOP_K);
    this.logger.debug({ query: params.query, mode, topK }, 'LightRAG /query/data retrieval');

    // Abort on EITHER a user Stop OR the per-request timeout.
    const timeoutSignal = AbortSignal.timeout(this.resolveTimeout());
    const reqSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    // /query/data reports no usage; tokenize the query we send and the JSON we
    // get back ourselves (same approach as the streaming path).
    const inputTokens = countTokens(params.query);
    const startedAt = Date.now();

    try {
      const res = await fetch(`${LIGHTRAG_URL}/query/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Latest user prompt ONLY — conversation_history is intentionally omitted.
          query: params.query,
          mode,
          top_k: topK,
          // Number of document chunks to retrieve from the vector store. Pinned so
          // chunks are actually returned (without it LightRAG can yield zero chunks
          // when only the KG side matched).
          chunk_top_k: DEFAULT_CHUNK_TOP_K,
          // Total token budget across entities + relations + chunks. Chunks are
          // budgeted LAST, so this must be roomy enough that they aren't squeezed
          // out to `[]` (see MAX_TOTAL_CONTEXT_TOKENS).
          max_total_tokens: MAX_TOTAL_CONTEXT_TOKENS,
          // No references needed for SQL grounding.
          include_references: false,
          // Include the actual chunk text so the SQL agent sees real schema/doc content.
          include_chunk_content: true,
        }),
        signal: reqSignal,
      });

      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'LightRAG /query/data non-OK response');
        const empty = this.emptyData();
        return { schemaJson: empty, metrics: this.buildMetrics(inputTokens, startedAt, empty) };
      }

      const payload = (await res.json()) as Record<string, unknown>;
      const schemaJson = this.formatRetrievedData(payload);
      return { schemaJson, metrics: this.buildMetrics(inputTokens, startedAt, schemaJson) };
    } catch (err) {
      // User pressed Stop: propagate so the chat loop unwinds without retrying.
      if (signal?.aborted) {
        this.logger.info('LightRAG /query/data retrieval aborted by user stop');
        throw err;
      }
      // Timeout or network failure: degrade to empty context so the SQL agent can
      // report a context gap rather than crash.
      this.logger.error({ err }, 'LightRAG /query/data request failed');
      const empty = this.emptyData();
      return { schemaJson: empty, metrics: this.buildMetrics(inputTokens, startedAt, empty) };
    }
  }

  private buildMetrics(inputTokens: number, startedAt: number, output: string): LightragMetrics {
    const durationMs = Date.now() - startedAt;
    // Non-streaming endpoint: first byte ≈ full response, so ttft ≈ duration.
    return { inputTokens, outputTokens: countTokens(output), ttftMs: durationMs, durationMs };
  }

  /**
   * Reduce a `/query/data` payload to the structured retrieval context the SQL
   * agent needs — entities, relationships and chunks — as pretty-printed JSON.
   * References are dropped (not needed for grounding). Tolerates either a
   * `{ data: {...} }` envelope or a bare data object.
   */
  private formatRetrievedData(payload: Record<string, unknown>): string {
    const data = (payload?.['data'] as Record<string, unknown> | undefined) ?? payload ?? {};
    const out = {
      entities: (data['entities'] as unknown[]) ?? [],
      relationships: (data['relationships'] as unknown[]) ?? [],
      chunks: (data['chunks'] as unknown[]) ?? [],
    };
    return JSON.stringify(out, null, 2);
  }

  private emptyData(): string {
    return JSON.stringify({ entities: [], relationships: [], chunks: [] }, null, 2);
  }

  /**
   * Consume LightRAG's `/query/stream` NDJSON body. Each newline-delimited line
   * is a JSON object: `{ response }` carries a generation delta (appended to the
   * accumulated text and forwarded to the live `sink` when present); a
   * `{ references }` line carries the cited sources. Non-JSON or unrecognized
   * lines are ignored. Returns the full concatenated response plus any references.
   */
  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    sink?: (delta: string) => void,
  ): Promise<{
    response: string;
    references: Array<{ path?: string; title?: string; score?: number }>;
    /** Timestamp (ms) of the first response delta — used for TTFT; undefined if none. */
    firstChunkAt?: number;
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let response = '';
    let firstChunkAt: number | undefined;
    let references: Array<{ path?: string; title?: string; score?: number }> = [];

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: { response?: unknown; references?: unknown };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return; // ignore keep-alive / non-JSON noise
      }
      if (typeof obj.response === 'string' && obj.response) {
        if (firstChunkAt === undefined) firstChunkAt = Date.now();
        response += obj.response;
        sink?.(obj.response);
      }
      if (Array.isArray(obj.references)) {
        references = obj.references as typeof references;
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
    } finally {
      reader.releaseLock();
    }

    return { response, references, firstChunkAt };
  }

  private resolveTimeout(): number {
    const raw = process.env.LIGHTRAG_TIMEOUT_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  private emptySchema(query: string) {
    return { query, schemaJson: '{"tables":[]}' };
  }
}
