import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const LIGHTRAG_API_URL = process.env.LIGHTRAG_API_URL ?? 'http://localhost:9621';

@Injectable()
export class RetrieveContextTool {
  constructor(
    @InjectPinoLogger(RetrieveContextTool.name) private readonly logger: PinoLogger,
  ) {}

  asTool() {
    const logger = this.logger;

    return tool(
      async ({ query, mode, topK }) => {
        logger.info({ query, mode, topK, url: LIGHTRAG_API_URL }, 'Querying LightRAG /query/stream');

        try {
          const res = await fetch(`${LIGHTRAG_API_URL}/query/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              mode: mode ?? 'mix',
              stream: true,
              include_references: true,
              top_k: topK ?? 10,
            }),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            logger.warn({ query, status: res.status, errText }, 'LightRAG /query/stream non-OK');
            return {
              documents: [],
              query,
              mode,
              sufficient: false,
              contextSummary: `LightRAG returned HTTP ${res.status}.`,
            };
          }

          const rawBody = await res.text();
          logger.debug({ rawLength: rawBody.length, preview: rawBody.slice(0, 500) }, 'LightRAG stream raw body');

          const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);

          let references: Array<{ reference_id: string; file_path: string }> = [];
          const responseChunks: string[] = [];
          let streamError: string | undefined;

          for (const line of lines) {
            try {
              const obj = JSON.parse(line) as {
                references?: Array<{ reference_id: string; file_path: string }>;
                response?: string;
                error?: string;
              };

              if (obj.references) {
                references = obj.references;
              } else if (typeof obj.response === 'string') {
                responseChunks.push(obj.response);
              } else if (typeof obj.error === 'string') {
                streamError = obj.error;
                logger.warn({ query, streamError }, 'LightRAG stream error object');
              }
            } catch {
              logger.debug({ line }, 'LightRAG stream: skipping non-JSON line');
            }
          }

          const fullResponse = responseChunks.join('').trim();

          if (streamError && !fullResponse) {
            return {
              documents: [],
              query,
              mode,
              sufficient: false,
              contextSummary: `LightRAG error: ${streamError}`,
            };
          }

          const documents: Array<{
            id: string;
            title: string;
            content: string;
            score: number;
            source: string;
          }> = [];

          if (fullResponse) {
            documents.push({
              id: 'lightrag-answer',
              title: 'LightRAG Knowledge Base Answer',
              content: fullResponse,
              score: 1.0,
              source: `lightrag/${mode}/stream`,
            });
          }

          references.forEach((ref) => {
            documents.push({
              id: `ref-${ref.reference_id}`,
              title: `Reference ${ref.reference_id}`,
              content: ref.file_path,
              score: 0.9,
              source: ref.file_path,
            });
          });

          const sufficient = fullResponse.length > 100;
          logger.info(
            { query, answerLength: fullResponse.length, referenceCount: references.length, sufficient },
            'LightRAG /query/stream succeeded',
          );

          return {
            documents,
            query,
            mode,
            sufficient,
            contextSummary: sufficient
              ? `Retrieved answer (${fullResponse.length} chars) with ${references.length} reference(s).`
              : 'LightRAG returned no results.',
          };
        } catch (err) {
          logger.error({ query, err }, 'LightRAG /query/stream request failed');
          return {
            documents: [],
            query,
            mode,
            sufficient: false,
            contextSummary: 'LightRAG request failed.',
          };
        }
      },
      {
        name: 'retrieve_context',
        description:
          'Retrieve relevant context from the LightRAG knowledge base. Always call this first before any other tool.',
        schema: z.object({
          query: z.string().describe('The user query or intent to retrieve context for'),
          mode: z
            .enum(['local', 'global', 'hybrid', 'naive', 'mix', 'bypass'])
            .optional()
            .default('mix'),
          topK: z.number().int().min(1).max(20).optional().default(10),
        }),
      },
    );
  }
}
