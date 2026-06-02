import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { JsonRenderSchemaService } from '../visualization/json-render.schema';
import { JSON_RENDER_COMPONENT_ALLOWLIST } from '../visualization/component-allowlist';

@Injectable()
export class JsonRenderTool {
  constructor(private readonly schemaService: JsonRenderSchemaService) {}

  asTool() {
    return createTool({
      id: 'harness_generate_json_render_spec',
      description:
        'Generate a json-render visualization spec from column metadata and transform shape. ' +
        'NEVER receives actual row data or dataState — spec references $.path expressions only.',
      inputSchema: z.object({
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        rowCount: z.number(),
        transformTargetShape: z.record(z.string(), z.unknown()),
        transformExpression: z.string(),
        visualizationIntent: z.string(),
        allowedComponents: z.array(z.string()).optional(),
      }),
      outputSchema: z.object({
        renderer: z.literal('json-render'),
        spec: z.record(z.string(), z.unknown()),
      }),
      execute: async (input) => {
        const spec = this.buildSpec(input);
        const validation = this.schemaService.validate(spec);

        const finalSpec = validation.valid ? spec : this.schemaService.repair(spec);

        return { renderer: 'json-render' as const, spec: finalSpec };
      },
    });
  }

  private buildSpec(input: {
    columns: Array<{ name: string; type: string }>;
    rowCount: number;
    transformTargetShape: Record<string, unknown>;
    transformExpression: string;
    visualizationIntent: string;
  }): Record<string, unknown> {
    const intent = input.visualizationIntent.toLowerCase();
    const hasSeries = 'series' in input.transformTargetShape;
    const hasRows = 'rows' in input.transformTargetShape;

    // Chart intent
    if (
      intent.includes('chart') ||
      intent.includes('bar') ||
      intent.includes('line') ||
      intent.includes('pie') ||
      hasSeries
    ) {
      const chartType = intent.includes('line')
        ? 'LineChart'
        : intent.includes('pie')
          ? 'PieChart'
          : 'BarChart';

      return {
        type: 'Dashboard',
        children: [
          {
            type: chartType,
            dataPath: '$.series',
            labelKey: 'label',
            valueKey: 'value',
            title: input.visualizationIntent,
          },
          {
            type: 'MetricCard',
            label: 'Total Rows',
            valuePath: '$.summary.rowCount',
          },
        ],
      };
    }

    // Table/list intent
    if (intent.includes('table') || intent.includes('list') || intent.includes('show') || hasRows) {
      return {
        type: 'Dashboard',
        children: [
          {
            type: 'DataTable',
            dataPath: '$.rows',
            columns: input.columns.map(c => ({
              key: c.name,
              label: c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            })),
            title: input.visualizationIntent,
          },
          {
            type: 'MetricCard',
            label: 'Total Rows',
            valuePath: '$.summary.rowCount',
          },
        ],
      };
    }

    // Metric/count default
    return {
      type: 'Dashboard',
      children: [
        {
          type: 'MetricCard',
          label: input.visualizationIntent,
          valuePath: '$.summary.rowCount',
        },
        {
          type: 'DataTable',
          dataPath: '$.rows',
          columns: input.columns.map(c => ({
            key: c.name,
            label: c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          })),
        },
      ],
    };
  }
}
