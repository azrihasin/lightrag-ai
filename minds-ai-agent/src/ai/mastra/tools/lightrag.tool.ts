import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { encode } from 'gpt-tokenizer';
import { currentRun } from '../../../analytics/analytics-run.store';

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
