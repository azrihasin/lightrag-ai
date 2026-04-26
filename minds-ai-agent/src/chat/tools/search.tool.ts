import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class SearchTool {
  asTool() {
    return tool({
      description: 'Perform a web search for current events, definitions, or general information.',
      inputSchema: z.object({
        query: z.string(),
        maxResults: z.number().int().min(1).max(10).optional().default(5),
      }),
      execute: async ({ query, maxResults }) => ({
        results: Array.from({ length: maxResults ?? 5 }, (_, i) => ({
          rank: i + 1,
          title: `Search result ${i + 1} for "${query}"`,
          url: `https://example.com/result-${i + 1}`,
          snippet: `Stubbed result for: ${query}`,
        })),
        query,
        totalFound: maxResults ?? 5,
      }),
    });
  }
}
