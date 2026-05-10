import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { UiComponentType } from '../dto/sse-event.dto';

/** Column name patterns that indicate geographic coordinate data. */
const LAT_PATTERNS = /^(lat(itude)?|lat_decimal|y_coord)$/i;
const LNG_PATTERNS = /^(lng|lon(gitude)?|long_decimal|x_coord)$/i;

function detectGeoColumns(columns: string[]): { latField?: string; lngField?: string } {
  const latField = columns.find((c) => LAT_PATTERNS.test(c));
  const lngField = columns.find((c) => LNG_PATTERNS.test(c));
  return { latField, lngField };
}

@Injectable()
export class PrepareVisualizationTool {
  asTool() {
    return tool(
      async ({ result, dataShape, preferredType }): Promise<{ suitable: boolean; componentType: UiComponentType; props: Record<string, unknown> }> => {
        const r = result as Record<string, unknown>;
        const rows = r?.rows as Record<string, unknown>[] | undefined;
        const columns = (dataShape?.columns ?? r?.columns) as string[] | undefined;
        const numericCols = dataShape?.numericCols ?? [];

        if (rows && rows.length > 0) {
          // Detect geographic data first — takes priority over chart/table
          const { latField, lngField } = columns ? detectGeoColumns(columns) : {};
          const isGeo = Boolean(latField && lngField);

          const type: UiComponentType =
            (preferredType as UiComponentType) ??
            (isGeo ? 'geo_map' : numericCols.length >= 1 && rows.length > 3 ? 'chart' : 'table');

          const geoHints =
            type === 'geo_map' && latField && lngField
              ? { latField, lngField, cluster: rows.length > 20 }
              : {};

          return {
            suitable: true,
            componentType: type,
            props: {
              rows,
              columns,
              rowCount: rows.length,
              ...geoHints,
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
      {
        name: 'prepare_visualization_data',
        description:
          'Determine whether visualization is suitable and prepare structured data for rendering. ' +
          'Detects geographic coordinate columns (lat/lng) and suggests geo_map automatically. ' +
          'Call after inspect_result when result has tabular or numeric data.',
        schema: z.object({
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
            .enum(['table', 'chart', 'list', 'metric-card', 'json-tree', 'geo_map'])
            .optional(),
        }),
      },
    );
  }
}
