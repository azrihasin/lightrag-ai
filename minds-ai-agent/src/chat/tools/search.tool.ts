import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class SearchTool {
  asTool() {
    return createTool({
      id: 'generic_search',
      description: 'Stub web search tool returning placeholder results.',
      inputSchema: z.object({
        query: z.string(),
        maxResults: z.number().int().min(1).max(10).optional().default(5),
      }),
      execute: async (input) => ({
        query: input.query,
        results: Array.from({ length: input.maxResults ?? 5 }, (_, i) => ({
          rank: i + 1,
          title: `Result ${i + 1} for "${input.query}"`,
          url: `https://example.com/result-${i + 1}`,
          snippet: `Stub result for: ${input.query}`,
        })),
      }),
    });
  }
}
