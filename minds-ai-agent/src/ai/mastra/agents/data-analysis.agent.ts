import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../../chat/providers/model.provider';
import { validateReadOnlySql } from '../../../analytics/agents/validate-sql.agent';
import { currentDataRun } from './data-analysis-run.store';
import {
  catalogComponentNames,
  catalogPromptBlock,
  getCatalogComponent,
} from '../visualization/catalog-descriptor';
import { VizJsonValidator } from '../../../analytics/viz/viz-json.validator';
import { fitCenterZoom } from '../../../analytics/viz/viz-json.compiler';
import type { VisualizationSpec } from '../../../analytics/analytics.types';

const MAX_PREVIEW_ROWS = 20;

const ChartEncodingSchema = z
  .object({
    x: z.string().optional().describe('Column for the x-axis / category (xy charts)'),
    series: z.array(z.string()).optional().describe('Numeric metric column(s) (xy charts)'),
    label: z.string().optional().describe('Category/label column (pie charts, map markers)'),
    value: z.string().optional().describe('Numeric value column (pie charts, kpi)'),
    lat: z.string().optional().describe('Latitude column (GeoMap)'),
    lng: z.string().optional().describe('Longitude column (GeoMap)'),
  })
  .optional();

/**
 * Shapes a {@link VisualizationSpec} straight from already-fetched JS rows
 * (the interpreter result set is small and already visible to the agent —
 * unlike the MariaDB pipeline there is no metadata-only privacy constraint
 * here, so this skips DuckDB re-shaping and just maps columns in JS).
 */
function buildVizSpec(
  chartType: string,
  encoding: z.infer<typeof ChartEncodingSchema>,
  rows: Record<string, unknown>[],
): VisualizationSpec | undefined {
  const comp = getCatalogComponent(chartType);
  if (!comp || comp.kind === 'table') return undefined;

  switch (comp.kind) {
    case 'xy': {
      if (!encoding?.x || !encoding.series?.length) return undefined;
      const data = rows.map((r) => ({ x: r[encoding.x!], ...Object.fromEntries(encoding.series!.map((s) => [s, r[s]])) }));
      return { componentType: chartType, props: { title: 'Result', data, xKey: 'x', series: encoding.series } };
    }
    case 'pie': {
      if (!encoding?.label || !encoding.value) return undefined;
      const data = rows.map((r) => ({ label: r[encoding.label!], value: r[encoding.value!] }));
      return { componentType: chartType, props: { title: 'Result', data, nameKey: 'label', valueKey: 'value' } };
    }
    case 'map': {
      if (!encoding?.lat || !encoding.lng) return undefined;
      const data = rows.map((r) => ({
        lat: r[encoding.lat!],
        lon: r[encoding.lng!],
        ...(encoding.label ? { label: r[encoding.label] } : {}),
      }));
      const { center, zoom } = fitCenterZoom(
        data
          .map((r) => [Number(r.lat), Number(r.lon)] as [number, number])
          .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo)),
      );
      return {
        componentType: chartType,
        props: {
          title: 'Result',
          center,
          zoom,
          data,
          latField: 'lat',
          lngField: 'lon',
          ...(encoding.label ? { labelField: 'label' } : {}),
          cluster: data.length > 200,
        },
      };
    }
    case 'kpi': {
      if (!encoding?.value) return undefined;
      const value = Number(rows[0]?.[encoding.value] ?? 0);
      return { componentType: chartType, props: { title: 'Result', value, ...(encoding.label ? { label: encoding.label } : {}) } };
    }
    default:
      return undefined;
  }
}

const INSTRUCTIONS = [
  'You are a data analyst with direct SQL access to one dataset the user provided (an uploaded file,',
  'pasted JSON, or the result set of a SQL query), loaded into a table called `t` (DuckDB SQL dialect).',
  'Behave like a code interpreter: inspect, clean, filter, group, and aggregate the data to answer the',
  'question.',
  '',
  'You are given the column names/types and a small sample of rows below. Use run_query to run',
  'read-only SELECT/WITH statements against `t` (or against a CTE built from it) as many times as',
  'you need to explore, clean, or aggregate — each call returns the row count, columns, and up to',
  `${MAX_PREVIEW_ROWS} rows so you can check your work.`,
  '',
  'When you have your final answer, call finalize EXACTLY ONCE with: the SQL that produces the final',
  'result table, a short natural-language answer, and OPTIONALLY a chart pick if a visualization would',
  'help (chartType from the catalog below + the encoding columns it needs). Leave chartType unset for',
  'a plain table result (e.g. a flat list with nothing meaningful to chart).',
  '',
  'Chart catalog:',
  catalogPromptBlock(),
].join('\n');

/**
 * Single self-contained "code interpreter" agent that iterates SQL against one
 * dataset already loaded into DuckDB table `t` (from an uploaded file, pasted
 * JSON, or a SQL result set). Unlike the MariaDB analytics pipeline (which masks
 * row values from the LLM for production-data privacy), this operates on data
 * the user themselves supplied, so the agent can see real sample rows and
 * iterate with real SQL, closer to how OpenAI's code interpreter behaves.
 */
@Injectable()
export class DataAnalysisAgentService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly vizValidator: VizJsonValidator,
  ) {
    this.agent = new Agent({
      id: 'data_analysis_interpreter',
      name: 'DataAnalysisAgent',
      instructions: INSTRUCTIONS,
      model: this.modelProvider.getModel() as any,
      tools: {
        run_query: this.runQueryTool(),
        finalize: this.finalizeTool(),
      },
    });
  }

  private runQueryTool() {
    return createTool({
      id: 'run_query',
      description: 'Run a read-only DuckDB SELECT/WITH against the loaded table `t` and preview the result.',
      inputSchema: z.object({ sql: z.string().describe('A SELECT/WITH statement referencing table `t`') }),
      outputSchema: z.object({
        ok: z.boolean(),
        error: z.string().optional(),
        rowCount: z.number().optional(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
        sampleRows: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
      execute: async ({ sql }: { sql: string }) => {
        const run = currentDataRun();
        if (!run) return { ok: false, error: 'No active data-analysis run.' };

        const safety = validateReadOnlySql(sql);
        if (!safety.valid) return { ok: false, error: safety.reason };

        run.iterations += 1;
        try {
          const rows = await run.scope.all<Record<string, unknown>>(sql);
          const columns =
            rows.length > 0
              ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
              : [];
          return { ok: true, rowCount: rows.length, columns, sampleRows: rows.slice(0, MAX_PREVIEW_ROWS) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Query failed.' };
        }
      },
    });
  }

  private finalizeTool() {
    return createTool({
      id: 'finalize',
      description: 'Record the final SQL, answer, and (optional) chart pick for this analysis.',
      inputSchema: z.object({
        sql: z.string().describe('The SQL that produces the final result table (referencing `t`)'),
        answer: z.string().describe('A short natural-language answer to the user question'),
        chartType: z
          .string()
          .optional()
          .describe(`A catalog component name, or omit for a plain table. Allowed: ${catalogComponentNames().join(', ')}`),
        encoding: ChartEncodingSchema,
      }),
      outputSchema: z.object({ ok: z.boolean(), error: z.string().optional(), componentType: z.string().optional() }),
      execute: async ({ sql, answer, chartType, encoding }) => {
        const run = currentDataRun();
        if (!run) return { ok: false, error: 'No active data-analysis run.' };

        const safety = validateReadOnlySql(sql);
        if (!safety.valid) return { ok: false, error: safety.reason };

        try {
          const rows = await run.scope.all<Record<string, unknown>>(sql);
          const columns =
            rows.length > 0
              ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
              : [];

          let spec: VisualizationSpec | undefined;
          if (chartType) {
            const candidate = buildVizSpec(chartType, encoding, rows);
            if (candidate) {
              const check = this.vizValidator.validate(candidate);
              if (check.valid) spec = candidate;
            }
          }

          run.final = { sql, answer, columns, rows, rowCount: rows.length, spec };
          return { ok: true, componentType: spec?.componentType };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Finalize query failed.' };
        }
      },
    });
  }
}
