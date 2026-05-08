import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class RetrievalTool {
  asTool() {
    return tool(
      async ({ query }: { query: string; topK?: number }) => ({
        documents: [{ id: 'doc-1', content: 'This is a placeholder document.', score: 1.0 }],
        query,
        totalRetrieved: 1,
      }),
      {
        name: 'retrieval',
        description: 'Retrieve relevant documents or knowledge base chunks for a given query.',
        schema: z.object({
          query: z.string(),
          topK: z.number().int().min(1).max(20).optional().default(5),
        }),
      },
    );
  }
}
