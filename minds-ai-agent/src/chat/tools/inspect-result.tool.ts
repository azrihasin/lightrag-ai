import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class InspectResultTool {
  asTool() {
    return tool({
      description:
        'Evaluate execution result quality and completeness. Determines whether the task is done or needs more steps.',
      inputSchema: z.object({
        actionId: z.string(),
        result: z.unknown(),
        intent: z.string(),
      }),
      execute: async ({ actionId, result, intent }) => {
        const r = result as Record<string, unknown>;
        const hasError = Boolean(r?.error);
        const rows = r?.rows as unknown[] | undefined;
        const hasRows = Array.isArray(rows) && rows.length > 0;
        const hasAnswer = Boolean(r?.answer || r?.result || r?.results);

        const complete = !hasError && (hasRows || hasAnswer);
        const quality = hasError ? 'failed' : hasRows || hasAnswer ? 'sufficient' : 'partial';

        const numericCols = hasRows
          ? (r.columns as string[] | undefined)?.filter(
              (c) => typeof (rows as Record<string, unknown>[])[0]?.[c] === 'number',
            ) ?? []
          : [];

        return {
          actionId,
          complete,
          quality,
          summary: hasError
            ? `Execution failed: ${String(r.error)}`
            : hasRows
              ? `Retrieved ${rows!.length} rows for: ${intent}`
              : hasAnswer
                ? `Action returned result for: ${intent}`
                : `Partial result for: ${intent}`,
          dataShape: hasRows
            ? {
                rowCount: rows!.length,
                columns: r.columns,
                hasNumericCols: numericCols.length > 0,
                numericCols,
              }
            : null,
        };
      },
    });
  }
}
