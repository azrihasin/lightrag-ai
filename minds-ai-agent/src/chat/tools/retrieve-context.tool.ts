import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class RetrieveContextTool {
  constructor(
    @InjectPinoLogger(RetrieveContextTool.name) private readonly logger: PinoLogger,
  ) {}

  asTool() {
    return createTool({
      id: 'retrieve_context',
      description: 'Retrieve relevant context from the LightRAG knowledge base.',
      inputSchema: z.object({
        query: z.string(),
        mode: z.enum(['local', 'global', 'hybrid', 'naive', 'mix', 'bypass']).optional().default('mix'),
        topK: z.number().int().min(1).max(20).optional().default(10),
      }),
      execute: async (input) => {
        const LIGHTRAG_URL = process.env.LIGHTRAG_API_URL ?? 'http://localhost:9621';
        try {
          const res = await fetch(`${LIGHTRAG_URL}/query/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: input.query, mode: input.mode ?? 'mix', stream: true, include_references: true, top_k: input.topK ?? 10 }),
          });

          if (!res.ok) {
            this.logger.warn({ status: res.status }, 'LightRAG non-OK');
            return { documents: [], query: input.query, sufficient: false, contextSummary: `LightRAG HTTP ${res.status}.` };
          }

          const rawBody = await res.text();
          const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);
          let references: Array<{ reference_id: string; file_path: string }> = [];
          const chunks: string[] = [];

          for (const line of lines) {
            try {
              const obj = JSON.parse(line) as { references?: typeof references; response?: string; error?: string };
              if (obj.references) references = obj.references;
              else if (typeof obj.response === 'string') chunks.push(obj.response);
            } catch { /* skip non-JSON */ }
          }

          const fullResponse = chunks.join('').trim();
          const documents: Array<{ id: string; title: string; content: string; score: number; source: string }> = [];
          if (fullResponse) documents.push({ id: 'lightrag-answer', title: 'LightRAG Answer', content: fullResponse, score: 1.0, source: 'lightrag/mix/stream' });
          references.forEach(ref => documents.push({ id: `ref-${ref.reference_id}`, title: `Ref ${ref.reference_id}`, content: ref.file_path, score: 0.9, source: ref.file_path }));

          const sufficient = fullResponse.length > 100;
          return {
            documents,
            query: input.query,
            sufficient,
            contextSummary: sufficient ? `Retrieved ${fullResponse.length} chars with ${references.length} ref(s).` : 'LightRAG returned no results.',
          };
        } catch (err) {
          this.logger.error({ err }, 'LightRAG request failed');
          return { documents: [], query: input.query, sufficient: false, contextSummary: 'LightRAG request failed.' };
        }
      },
    });
  }
}
