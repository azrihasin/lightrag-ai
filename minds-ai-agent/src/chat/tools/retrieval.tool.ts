import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class RetrievalTool {
  asTool() {
    return tool({
      description: 'Retrieve relevant documents or knowledge base chunks for a given query.',
      inputSchema: z.object({
        query: z.string(),
        topK: z.number().int().min(1).max(20).optional().default(5),
      }),
      execute: async ({ query }) => ({
        documents: [{ id: 'doc-1', content: 'This is a placeholder document.', score: 1.0 }],
        query,
        totalRetrieved: 1,
      }),
    });
  }
}
