import { Injectable } from '@nestjs/common';
import type { ToolResult } from '../tools/tool-registry';
import type { UiComponentType, DataSpecPayload } from '../dto/sse-event.dto';

interface DiscoveryResult {
  componentType: UiComponentType;
  props: Record<string, unknown>;
}

@Injectable()
export class UiDiscoveryService {
  inspect(toolResult: ToolResult | null): DiscoveryResult | null {
    if (!toolResult) return null;

    const output = toolResult.output as Record<string, unknown>;

    try {
      switch (toolResult.toolName) {
        // New tool names
        case 'execute_sql':
        // Legacy alias
        case 'sql_execute': {
          const rows = output.rows as unknown[] | undefined;
          if (!rows || rows.length === 0) return null;
          const columns = output.columns as string[] | undefined;
          const numericCols =
            columns?.filter((col) =>
              (rows as Record<string, unknown>[]).every((r) => typeof r[col] === 'number'),
            ) ?? [];
          if (numericCols.length >= 1 && rows.length > 3) {
            return {
              componentType: 'chart',
              props: { chartType: 'bar', data: rows, xKey: columns?.[0], yKeys: numericCols, columns },
            };
          }
          return { componentType: 'table', props: { rows, columns, rowCount: output.rowCount } };
        }

        case 'execute_system_action': {
          // Unwrap the nested result from the system action executor
          const inner = output.result as Record<string, unknown> | undefined;
          if (!inner) return null;
          // Synthetic data
          if (Array.isArray(inner.rows) && (inner.rows as unknown[]).length > 0) {
            const rows = inner.rows as Record<string, unknown>[];
            const columns = inner.columns as string[] | undefined;
            const schema = inner.schema as Array<{ name: string; type: string }> | undefined;
            const numericCols = schema?.filter((f) => f.type === 'number').map((f) => f.name) ?? [];
            if (numericCols.length >= 1 && rows.length >= 5) {
              return {
                componentType: 'chart',
                props: {
                  chartType: rows.length <= 12 ? 'bar' : 'line',
                  data: rows,
                  xKey: columns?.[0] ?? 'id',
                  yKeys: numericCols,
                },
              };
            }
            return { componentType: 'table', props: { rows, columns, rowCount: rows.length } };
          }
          // Search results
          if (Array.isArray(inner.results) && (inner.results as unknown[]).length > 0) {
            return { componentType: 'list', props: { items: inner.results, query: inner.query } };
          }
          // Calculator result
          if (inner.result !== undefined && !inner.error) {
            return {
              componentType: 'metric-card',
              props: { label: inner.expression, value: inner.result, formatted: inner.formatted },
            };
          }
          return null;
        }

        case 'retrieve_context':
        // Legacy alias
        case 'retrieval': {
          const docs = output.documents as unknown[] | undefined;
          if (!docs || docs.length === 0) return null;
          return { componentType: 'list', props: { items: docs, query: output.query } };
        }

        case 'generic_search': {
          const results = output.results as unknown[] | undefined;
          if (!results || results.length === 0) return null;
          return { componentType: 'list', props: { items: results, query: output.query } };
        }

        case 'calculator': {
          if (output.error) return null;
          return {
            componentType: 'metric-card',
            props: { label: output.expression, value: output.result, formatted: output.formatted },
          };
        }

        // No UI annotation needed for planning/validation/generation tools
        case 'generate_sql':
        case 'validate_sql':
        case 'validate_action':
        case 'generate_action':
        case 'inspect_result':
        case 'compose_final_response':
        case 'summarize_result':
        case 'sql_generate':
          return null;

        default: {
          // Fallback: rows → table, weather fields → weather-card
          if (Array.isArray(output.rows) && (output.rows as unknown[]).length > 0) {
            return {
              componentType: 'table',
              props: { rows: output.rows, rowCount: (output.rows as unknown[]).length },
            };
          }
          if ('temperature' in output || 'humidity' in output || 'weather' in output) {
            return { componentType: 'weather-card', props: output };
          }
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  buildDataSpec(discovery: DiscoveryResult): DataSpecPayload {
    return { componentType: discovery.componentType, props: discovery.props };
  }
}
