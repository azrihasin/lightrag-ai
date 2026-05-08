import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class SearchTool {
  asTool() {
    return tool(
      async ({ query, maxResults }) => ({
        results: Array.from({ length: maxResults ?? 5 }, (_, i) => ({
          rank: i + 1,
          title: `Search result ${i + 1} for "${query}"`,
          url: `https://example.com/result-${i + 1}`,
          snippet: `Stubbed result for: ${query}`,
        })),
        query,
        totalFound: maxResults ?? 5,
      }),
      {
        name: 'generic_search',
        description: 'Perform a web search for current events, definitions, or general information.',
        schema: z.object({
          query: z.string(),
          maxResults: z.number().int().min(1).max(10).optional().default(5),
        }),
      },
    );
  }
}
