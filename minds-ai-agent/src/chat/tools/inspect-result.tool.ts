import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class InspectResultTool {
  asTool() {
    return tool(
      async ({ actionId, result, intent }) => {
        const r = result as Record<string, unknown>;
        const hasError = Boolean(r?.error);
        const rows = r?.rows as unknown[] | undefined;
        const rowCount = (r?.rowCount as number | undefined) ?? 0;
        const hasRows = (Array.isArray(rows) && rows.length > 0) || rowCount > 0;
        const hasAnswer = Boolean(r?.answer || r?.result || r?.results);

        const complete = !hasError && (hasRows || hasAnswer);
        const quality = hasError ? 'failed' : hasRows || hasAnswer ? 'sufficient' : 'partial';

        const numericCols = hasRows && Array.isArray(rows) && rows.length > 0
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
              ? `Retrieved ${rowCount} rows for: ${intent}`
              : hasAnswer
                ? `Action returned result for: ${intent}`
                : `Partial result for: ${intent}`,
          dataShape: hasRows
            ? {
                rowCount,
                columns: r.columns,
                hasNumericCols: numericCols.length > 0,
                numericCols,
              }
            : null,
        };
      },
      {
        name: 'inspect_result',
        description:
          'Evaluate execution result quality and completeness. Determines whether the task is done or needs more steps.',
        schema: z.object({
          actionId: z.string(),
          result: z.unknown(),
          intent: z.string(),
        }),
      },
    );
  }
}
