import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class SummarizeResultTool {
  asTool() {
    return createTool({
      id: 'summarize_result',
      description: 'Summarize an execution result into a human-readable string.',
      inputSchema: z.object({
        result: z.unknown(),
        intent: z.string(),
      }),
      execute: async (input) => {
        const result = input.result as Record<string, unknown> | null;
        if (!result) return { summary: 'No result to summarize.' };
        const rowCount = (result.rowCount as number | undefined) ?? (result.rows as unknown[] | undefined)?.length ?? 0;
        const cols = (result.columns as string[] | undefined) ?? [];
        return {
          summary: `Retrieved ${rowCount} row(s) with columns: ${cols.join(', ') || 'n/a'} for: ${input.intent}`,
        };
      },
    });
  }
}
