import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class SummarizeResultTool {
  asTool() {
    return tool(
      async ({ result, intent, maxLength }) => {
        const r = result as Record<string, unknown>;
        const limit = maxLength ?? 600;
        let summary: string;

        const rows = r?.rows as unknown[] | undefined;
        if (rows && rows.length > 0) {
          const preview = rows
            .slice(0, 3)
            .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
            .join('; ');
          summary = `Found ${rows.length} result${rows.length > 1 ? 's' : ''} for "${intent}". ${preview}${rows.length > 3 ? ` … and ${rows.length - 3} more.` : ''}`;
        } else if (r?.answer) {
          summary = String(r.answer);
        } else if (r?.result !== undefined) {
          summary = `Computed result for "${intent}": ${String(r.result)}`;
        } else if (Array.isArray(r?.results)) {
          const items = r.results as Record<string, unknown>[];
          summary = `Found ${items.length} item${items.length > 1 ? 's' : ''} for "${intent}".`;
        } else {
          summary = `Completed action for: ${intent}. ${JSON.stringify(result).slice(0, limit)}`;
        }

        return { summary: summary.slice(0, limit), intent };
      },
      {
        name: 'summarize_result',
        description:
          'Summarize execution results in natural language when visualization is not suitable or preferred.',
        schema: z.object({
          result: z.unknown(),
          intent: z.string(),
          maxLength: z.number().int().min(50).max(2000).optional().default(600),
        }),
      },
    );
  }
}
