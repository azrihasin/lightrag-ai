import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { currentRun } from '../../../analytics/analytics-run.store';

/**
 * Strict schema-formatter prompt handed to LightRAG's generation step. LightRAG
 * uses this prompt to turn the retrieved context into a constrained JSON schema
 * whitelist (exact table/column names only) — never prose, SQL, or explanations.
 */
const SCHEMA_USER_PROMPT =
  "You are a strict database schema retrieval formatter. Your only task is to return the complete relevant database schema needed to answer the user's query as accurately as possible, using only exact table names and exact column names that are explicitly present in the retrieved LightRAG context. Do not minimize too aggressively; include every table and column that may be needed for accurate SQL generation, including columns needed for joins, filters, grouping, aggregation, ordering, time conditions, status conditions, identifiers, labels, dimensions, and metrics implied by the user's request. Do not infer, rename, normalize, singularize, pluralize, translate, correct spelling, change casing, add prefixes, remove prefixes, or invent any database name, schema name, table name, column name, key, or relationship. If a table or column is only semantically implied but not explicitly shown in the retrieved context, exclude it. If a generic entity or column name appears without a clearly attached table, do not treat it as usable unless the context explicitly maps that column to that table. Return only valid compact JSON and nothing else. Do not include markdown, prose, explanations, summaries, confidence scores, SQL, comments, or reasoning. The JSON shape must be exactly {\"tables\":[{\"table\":\"exact_table_name\",\"columns\":[\"exact_column_name_1\",\"exact_column_name_2\"]}]}. The \"table\" value must be an exact table name only — never a database name, schema name, or qualifier on its own; if a table appears qualified in the context (e.g. schema.table), keep the table identifier exactly as shown but do not emit a bare schema/database name as a table. Include all relevant and useful tables and columns that are supported by the retrieved context and could improve SQL accuracy. Include bridge, lookup, dimension, fact, mapping, backup, or relationship tables when they may be required for joins, filters, grouping, aggregation, labels, or time conditions in the user's query. Preserve exact spelling and casing from the retrieved context. If the retrieved context is insufficient to identify at least one exact table and exact relevant column, return exactly {\"tables\":[]}.";

const DEFAULT_TIMEOUT_MS = 30_000;
// Breadth of entities/relations LightRAG retrieves before formatting. This is a
// HARD CEILING, not just a default: a larger top_k means LightRAG pulls (and the
// downstream LLM formats) more context, which costs more per call. The master
// agent retries retrieve_context on failure, so an ever-growing top_k would
// multiply cost on every retry. We therefore clamp every request to this value —
// retries re-run at the same breadth instead of escalating it.
const DEFAULT_TOP_K = 6;

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
            `Entities/relations to retrieve; defaults to ${DEFAULT_TOP_K} when omitted. ` +
              `This is capped at ${DEFAULT_TOP_K} — do NOT raise it when retrying a failed ` +
              `retrieval, as a larger value does not improve grounding and only increases cost.`,
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

        try {
          // GUARDRAIL: only_need_context is intentionally FALSE so LightRAG's
          // generation step runs and formats the retrieved context into a compact
          // JSON schema whitelist (exact names only) via SCHEMA_USER_PROMPT.
          const res = await fetch(`${LIGHTRAG_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: input.query,
              mode: input.mode ?? 'local',
              only_need_context: false,
              enable_rerank: true,
              include_references: false,
              top_k: topK,
              user_prompt: SCHEMA_USER_PROMPT,
              stream: false,
            }),
            signal,
          });

          if (!res.ok) {
            this.logger.warn({ status: res.status }, 'LightRAG non-OK response');
            return this.emptySchema(input.query);
          }

          const body = (await res.json()) as { response?: string };
          const schemaJson = (body.response ?? '').trim() || '{"tables":[]}';

          // Record the schema on the run blackboard so the SQL agent and the
          // grounding guard see exactly this whitelist as the allowed schema.
          const run = currentRun();
          if (run) {
            run.retrievedContext = schemaJson;
            run.contextReferences = [];
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
        }
      },
    });
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
