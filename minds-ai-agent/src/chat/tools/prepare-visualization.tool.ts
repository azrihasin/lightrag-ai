import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import type { UiComponentType } from '../dto/sse-event.dto';

@Injectable()
export class PrepareVisualizationTool {
  asTool() {
    return tool({
      description:
        'Determine whether visualization is suitable and prepare structured data for rendering. ' +
        'Call after inspect_result when result has tabular or numeric data.',
      inputSchema: z.object({
        result: z.unknown(),
        dataShape: z
          .object({
            rowCount: z.number().optional(),
            columns: z.array(z.string()).optional(),
            hasNumericCols: z.boolean().optional(),
            numericCols: z.array(z.string()).optional(),
          })
          .optional(),
        preferredType: z
          .enum(['table', 'chart', 'list', 'metric-card', 'json-tree'])
          .optional(),
      }),
      execute: async ({ result, dataShape, preferredType }): Promise<{
        suitable: boolean;
        componentType: UiComponentType;
        props: Record<string, unknown>;
      }> => {
        const r = result as Record<string, unknown>;
        const rows = r?.rows as Record<string, unknown>[] | undefined;
        const columns = (dataShape?.columns ?? r?.columns) as string[] | undefined;
        const numericCols = dataShape?.numericCols ?? [];

        if (rows && rows.length > 0) {
          const type: UiComponentType =
            (preferredType as UiComponentType) ??
            (numericCols.length >= 1 && rows.length > 3 ? 'chart' : 'table');
          return {
            suitable: true,
            componentType: type,
            props: {
              rows,
              columns,
              rowCount: rows.length,
              ...(type === 'chart'
                ? {
                    chartType: rows.length <= 12 ? 'bar' : 'line',
                    xKey: columns?.[0],
                    yKeys: numericCols,
                  }
                : {}),
            },
          };
        }

        const val = r?.result ?? r?.value;
        if (val !== undefined) {
          return {
            suitable: true,
            componentType: 'metric-card',
            props: {
              label: r?.expression ?? r?.label ?? 'Result',
              value: val,
              formatted: String(val),
            },
          };
        }

        const items = r?.results ?? r?.documents ?? r?.items;
        if (Array.isArray(items) && items.length > 0) {
          return {
            suitable: true,
            componentType: 'list',
            props: { items, query: r?.query },
          };
        }

        return { suitable: false, componentType: 'text', props: {} };
      },
    });
  }
}
