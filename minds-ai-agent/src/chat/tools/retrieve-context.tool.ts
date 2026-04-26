import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { tool } from 'ai';
import { z } from 'zod';

const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL ?? 'http://localhost:9621';

@Injectable()
export class RetrieveContextTool {
  constructor(
    @InjectPinoLogger(RetrieveContextTool.name) private readonly logger: PinoLogger,
  ) {}

  asTool() {
    const logger = this.logger;

    return tool({
      description:
        'Retrieve relevant context from the LightRAG knowledge base. Always call this first before any other tool.',
      inputSchema: z.object({
        query: z.string().describe('The user query or intent to retrieve context for'),
        mode: z.enum(['semantic', 'hybrid', 'keyword']).optional().default('hybrid'),
        maxDocuments: z.number().int().min(1).max(10).optional().default(5),
      }),
      execute: async ({ query, mode, maxDocuments }) => {
        logger.info({ query, mode, maxDocuments, url: LIGHTRAG_API_URL }, 'Querying LightRAG');

        // ── /retrieval endpoint (raw chunks) ───────────────────────────────
        try {
          const retrievalRes = await fetch(`${LIGHTRAG_API_URL}/retrieval`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, mode: mode ?? 'hybrid', top_k: maxDocuments ?? 5 }),
          });

          if (retrievalRes.ok) {
            const raw = await retrievalRes.text();
            logger.debug({ endpoint: '/retrieval', rawLength: raw.length, raw: raw.slice(0, 500) }, 'LightRAG raw response');

            const data = JSON.parse(raw) as {
              status?: string;
              data?: {
                chunks?: Array<{ id?: string; content: string; score?: number; source?: string }>;
                entities?: Array<{ entity_name?: string; description?: string }>;
              };
            };

            const chunks = data?.data?.chunks ?? [];
            const entities = data?.data?.entities ?? [];

            const entityDocs = entities.slice(0, 3).map((e, i) => ({
              id: `entity-${i + 1}`,
              title: e.entity_name ?? `Entity ${i + 1}`,
              content: e.description ?? '',
              score: 0.8,
              source: 'lightrag/entity',
            }));

            const documents = [
              ...chunks.map((c, i) => ({
                id: c.id ?? `chunk-${i + 1}`,
                title: `Document ${i + 1}`,
                content: c.content,
                score: c.score ?? 1.0,
                source: c.source ?? `lightrag/${mode}/${i + 1}`,
              })),
              ...entityDocs,
            ].slice(0, maxDocuments ?? 5);

            const sufficient = documents.length > 0;
            logger.info({ query, documentCount: documents.length, sufficient, endpoint: '/retrieval' }, 'LightRAG retrieval succeeded');
            return { documents, query, mode, sufficient, contextSummary: sufficient ? `Found ${documents.length} document(s).` : 'No documents found.' };
          }

          logger.warn({ query, status: retrievalRes.status, endpoint: '/retrieval' }, 'LightRAG /retrieval non-OK');
        } catch (err) {
          logger.warn({ query, err, endpoint: '/retrieval' }, 'LightRAG /retrieval failed');
        }

        // ── /query endpoint (answer text) ──────────────────────────────────
        try {
          const queryRes = await fetch(`${LIGHTRAG_API_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, mode: mode ?? 'hybrid', top_k: maxDocuments ?? 5 }),
          });

          if (queryRes.ok) {
            const raw = await queryRes.text();
            logger.debug({ endpoint: '/query', rawLength: raw.length, raw: raw.slice(0, 500) }, 'LightRAG raw response');

            // LightRAG may return plain text or JSON — handle both
            let answer = '';
            try {
              const data = JSON.parse(raw) as { status?: string; data?: unknown; response?: unknown; result?: unknown };
              // Unwrap whichever field contains the answer string
              const candidate = data?.data ?? data?.response ?? data?.result ?? data;
              answer = typeof candidate === 'string' ? candidate : raw;
            } catch {
              // Response is plain text
              answer = raw;
            }

            answer = answer.trim();
            logger.info({ query, answerLength: answer.length, answerPreview: answer.slice(0, 200), endpoint: '/query' }, 'LightRAG /query result');

            if (answer.length > 0) {
              return {
                documents: [{
                  id: 'lightrag-answer',
                  title: 'LightRAG Knowledge Base',
                  content: answer,
                  score: 1.0,
                  source: `lightrag/${mode}/query`,
                }],
                query,
                mode,
                sufficient: true,
                contextSummary: 'Retrieved answer from LightRAG knowledge base.',
              };
            }

            logger.warn({ query, endpoint: '/query' }, 'LightRAG /query returned empty answer');
          } else {
            logger.warn({ query, status: queryRes.status, endpoint: '/query' }, 'LightRAG /query non-OK');
          }
        } catch (err) {
          logger.warn({ query, err, endpoint: '/query' }, 'LightRAG /query failed');
        }

        logger.warn({ query }, 'LightRAG returned no usable results — agent will use general knowledge');
        return {
          documents: [],
          query,
          mode,
          sufficient: false,
          contextSummary: 'LightRAG returned no results.',
        };
      },
    });
  }
}
