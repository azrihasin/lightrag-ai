import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import { currentRun } from '../../../analytics/analytics-run.store';

const DEFAULT_TOP_K = 8;
const TABLE_NAME = 'vdb_chunks';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large';

/** One retrieved schema chunk row from the LanceDB `vdb_chunks` table. */
interface ChunkRow {
  content?: unknown;
  file_path?: unknown;
}

@Injectable()
export class LancedbRetrievalTool {
  // Connection, table handle and embedding model are resolved once on the first
  // call and reused across invocations — opening the dataset and constructing the
  // embedding client on every retrieval would be wasteful.
  private tablePromise?: Promise<lancedb.Table>;
  private ftsReady?: Promise<void>;

  constructor(
    @InjectPinoLogger(LancedbRetrievalTool.name) private readonly logger: PinoLogger,
  ) {}

  asTool() {
    return createTool({
      id: 'harness_retrieve_context',
      description:
        'Retrieve a database schema whitelist from a local LanceDB hybrid search as compact JSON ' +
        '({ tables: [{ table, columns }] }) containing only exact table/column names. ' +
        'Downstream SQL generation must treat this JSON as the only allowed schema.',
      inputSchema: z.object({
        query: z.string().describe('Schema-oriented retrieval query derived from user intent'),
        topK: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `Number of schema chunks to retrieve from LanceDB; defaults to ${DEFAULT_TOP_K}.`,
          ),
      }),
      outputSchema: z.object({
        query: z.string(),
        /** The JSON schema whitelist string, passed as context to the SQL agent. */
        schemaJson: z.string(),
      }),
      execute: async (input, ctx?: { abortSignal?: AbortSignal }) => {
        const userSignal = ctx?.abortSignal;

        // If the user already stopped before this call even starts, do not run any
        // retrieval — abort immediately.
        if (userSignal?.aborted) {
          throw userSignal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        const topK = input.topK ?? DEFAULT_TOP_K;
        this.logger.debug({ query: input.query, topK }, 'LanceDB hybrid schema retrieval');

        const run = currentRun();
        const sink = run?.onRetrievalChunk;
        const startedAt = Date.now();

        try {
          const { chunks, mode } = await this.search(input.query, topK, userSignal);

          // Turn the retrieved schema chunks into the strict whitelist JSON. The
          // table/column identifiers are kept verbatim so the grounding guard in
          // sql-grounding.ts still passes.
          const schemaJson = this.toSchemaWhitelist(chunks);
          const references = this.toReferences(chunks);

          if (run) {
            run.retrievedContext = schemaJson;
            run.contextReferences = references;
            run.retrievalMetrics = {
              topK,
              durationMs: Date.now() - startedAt,
              // Every returned chunk is grounded by vector similarity; FTS only
              // contributes when the hybrid path ran (0 on the pure-vector fallback).
              vectorHits: chunks.length,
              ftsHits: mode === 'hybrid' ? chunks.length : 0,
            };
          }

          // Stream the assembled whitelist into the live reasoning block (chat path
          // only) so the user sees exactly what schema the SQL is written against.
          sink?.(schemaJson);

          return { query: input.query, schemaJson };
        } catch (err) {
          // User pressed Stop: propagate the abort so the agent loop unwinds and
          // does NOT silently retry the retrieval.
          if (userSignal?.aborted) {
            this.logger.info('LanceDB retrieval aborted by user stop');
            throw err;
          }
          // Any other failure: degrade to an empty schema so the agent can report
          // insufficient context rather than crash.
          this.logger.error({ err }, 'LanceDB retrieval failed');
          return this.emptySchema(input.query);
        } finally {
          // Close the live code-block fence (if one was opened) regardless of
          // outcome, so the UI never gets stuck with an unterminated block.
          run?.onRetrievalEnd?.();
        }
      },
    });
  }

  /**
   * True hybrid search: dense vector similarity (semantic meaning) combined with
   * BM25 full-text search over `content`, fused with Reciprocal Rank Fusion. Falls
   * back to pure vector search if the FTS index or hybrid query is unavailable.
   */
  private async search(
    query: string,
    topK: number,
    signal?: AbortSignal,
  ): Promise<{ chunks: ChunkRow[]; mode: 'hybrid' | 'vector' }> {
    const table = await this.getTable();
    const queryVector = await this.embedQuery(query);

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    try {
      await this.ensureFtsIndex(table);
      const reranker = await lancedb.rerankers.RRFReranker.create();
      const rows = (await table
        .query()
        .fullTextSearch(query)
        .nearestTo(queryVector)
        .rerank(reranker)
        .limit(topK)
        .toArray()) as ChunkRow[];
      return { chunks: rows, mode: 'hybrid' };
    } catch (err) {
      // Hybrid/FTS unavailable (e.g. index build failed) — fall back to a pure
      // dense vector search so retrieval still returns semantically relevant rows.
      this.logger.warn({ err }, 'Hybrid search unavailable; falling back to vector search');
      const rows = (await table
        .query()
        .nearestTo(queryVector)
        .limit(topK)
        .toArray()) as ChunkRow[];
      return { chunks: rows, mode: 'vector' };
    }
  }

  /** Connect to the LanceDB directory once and open the `vdb_chunks` table. */
  private getTable(): Promise<lancedb.Table> {
    if (!this.tablePromise) {
      const dbDir = process.env.LANCEDB_DIR ?? path.join(process.cwd(), 'lancedb');
      this.tablePromise = lancedb.connect(dbDir).then((db) => db.openTable(TABLE_NAME));
    }
    return this.tablePromise;
  }

  /**
   * Idempotently create the full-text search index on `content`. The build runs
   * at most once per process; an "already exists" error from a previously-built
   * index is treated as success.
   */
  private ensureFtsIndex(table: lancedb.Table): Promise<void> {
    if (!this.ftsReady) {
      this.ftsReady = table
        .createIndex('content', { config: lancedb.Index.fts() })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (/already exists/i.test(message)) return;
          throw err;
        });
    }
    return this.ftsReady;
  }

  /**
   * Embed the query with the same OpenAI-compatible model that produced the stored
   * vectors (text-embedding-3-large, 3072-dim), via the existing createOpenAI
   * baseURL/apiKey pattern.
   */
  private async embedQuery(query: string): Promise<number[]> {
    const provider = createOpenAI({
      baseURL: process.env.LLM_BINDING_HOST ?? 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
    });
    const model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    const { embedding } = await embed({ model: provider.textEmbeddingModel(model), value: query });
    return embedding;
  }

  /**
   * Deterministically parse the retrieved schema chunks into the strict whitelist
   * JSON `{"tables":[{"table":"<exact_name>","columns":["<exact_col>", ...]}]}`.
   *
   * Chunk content lists schema docs as `TABLE <table>` headers followed by
   * `- <table>.<column> : <type>` lines. Each column line is fully qualified, so a
   * table can be recovered even from a chunk that starts mid-table (no header).
   * All identifiers are copied verbatim so the grounding guard still passes.
   */
  private toSchemaWhitelist(chunks: ChunkRow[]): string {
    const tables = new Map<string, { columns: string[]; seen: Set<string> }>();
    const ensure = (table: string) => {
      let entry = tables.get(table);
      if (!entry) {
        entry = { columns: [], seen: new Set() };
        tables.set(table, entry);
      }
      return entry;
    };

    for (const chunk of chunks) {
      const content = typeof chunk.content === 'string' ? chunk.content : '';
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        // `TABLE <name>` header — register the table even if its columns are in a
        // different chunk.
        const tableHeader = line.match(/^TABLE\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*)/);
        if (tableHeader) {
          ensure(tableHeader[1]);
          continue;
        }
        // `- <table>.<column> : <type>` column line.
        const col = line.match(/^-\s*([A-Za-z_][\w$.]*)\s*:/);
        if (col) {
          const qualified = col[1];
          const dot = qualified.lastIndexOf('.');
          if (dot <= 0) continue;
          const table = qualified.slice(0, dot);
          const column = qualified.slice(dot + 1);
          const entry = ensure(table);
          if (!entry.seen.has(column)) {
            entry.seen.add(column);
            entry.columns.push(column);
          }
        }
      }
    }

    const out = {
      tables: [...tables.entries()].map(([table, { columns }]) => ({ table, columns })),
    };
    return JSON.stringify(out);
  }

  /** Distinct source files of the retrieved chunks, as context references. */
  private toReferences(
    chunks: ChunkRow[],
  ): Array<{ path?: string; title?: string; score?: number }> {
    const seen = new Set<string>();
    const refs: Array<{ path?: string; title?: string }> = [];
    for (const chunk of chunks) {
      const filePath = typeof chunk.file_path === 'string' ? chunk.file_path : undefined;
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      refs.push({ path: filePath, title: filePath });
    }
    return refs;
  }

  private emptySchema(query: string) {
    return { query, schemaJson: '{"tables":[]}' };
  }
}
