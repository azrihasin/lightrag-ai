import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import {
  catalogComponentNames,
  catalogPromptBlock,
} from '../../ai/mastra/visualization/catalog-descriptor';
import { VizPlanSchema, type VizPlan } from '../viz/viz-plan.types';
import { VizPlanValidator } from '../viz/viz-plan.validator';
import { VizJsonCompiler } from '../viz/viz-json.compiler';
import { VizJsonValidator } from '../viz/viz-json.validator';
import type { ResultProfile } from '../profile/result-profile.types';

/** Compact, metadata-only rendering of the result profile for the agent prompt. */
function renderProfile(profile: ResultProfile): string {
  const cols = profile.columns
    .map(
      (c) =>
        `  - ${c.name} [${c.role}/${c.semanticType}] cardinality:${c.cardinalityBucket}` +
        (c.min != null ? ` min:${c.min} max:${c.max}` : ''),
    )
    .join('\n');
  const f = profile.chartFeasibility;
  const feasible = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');
  return [
    `rows: ${profile.rowCount}, columns: ${profile.columnCount}`,
    `geoAvailable: ${profile.geoAvailable}` +
      (profile.timeGranularity ? `, timeGranularity: ${profile.timeGranularity}` : ''),
    `feasible charts: ${feasible || 'none'}`,
    `ranked candidates: ${profile.vizCandidates.join(', ')}`,
    'columns:',
    cols,
  ].join('\n');
}

/**
 * Subagent — plan_visualization. Receives ONLY metadata (intent, dataset output
 * columns, and the metadata-only result profile) — never rows. It emits a
 * VizPlan; NestJS applies deterministic rules, then DuckDB shapes the canonical
 * spec. The agent never touches row data or produces renderer-ready values.
 */
@Injectable()
export class VisualizationAgentService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly vizValidator: VizPlanValidator,
    private readonly jsonCompiler: VizJsonCompiler,
    private readonly jsonValidator: VizJsonValidator,
  ) {
    this.agent = new Agent({
      id: 'plan_visualization',
      name: 'PlanVisualizationAgent',
      description:
        'Choose the best visualization for the result from its metadata profile and record a ' +
        'VizPlan. Run LAST, after execute_dataset / summarize_result.',
      instructions: () => {
        const run = currentRun();
        const profile = run?.resultProfile;
        const profileBlock = profile
          ? `\n\n---\n\n## Result profile (metadata only — no row values)\n${renderProfile(profile)}`
          : '';
        return (
          [
            'You choose the best visualization from this catalog (you see ONLY metadata, never rows):',
            catalogPromptBlock(),
            '',
            'Begin your reply with ONE short sentence (e.g. "Choosing how to present these results.").',
            'Guidelines:',
            '- Prefer the ranked candidates from the result profile; they reflect what the data supports.',
            '- Set shouldVisualize:false (a plain table) for flat lists or when no chart is meaningful.',
            '- xy charts: encoding.x = a dimension column, encoding.series = numeric metric column(s).',
            '- pie: encoding.label = a category column, encoding.value = a numeric metric column.',
            '- GeoMap: only when geoAvailable is true; coordinates are detected automatically.',
            '- KPI (ChartRadialText): a single headline number (one row, one metric).',
            '- Use ONLY the column names listed in the result profile.',
            'Call select_visualization exactly once with your VizPlan, then state your choice briefly.',
            'Deterministic backend rules may adjust your choice to fit the data; that is expected.',
          ].join('\n') + profileBlock
        );
      },
      model: this.modelProvider.getModel() as any,
      tools: { select_visualization: this.selectTool() },
    });
  }

  private selectTool() {
    return createTool({
      id: 'select_visualization',
      description:
        'Record a VizPlan (chart type + encodings referencing dataset columns). The backend ' +
        'validates it and shapes the canonical spec in DuckDB.',
      inputSchema: VizPlanSchema.extend({
        chartType: z
          .string()
          .describe(`A catalog component name. Allowed: ${catalogComponentNames().join(', ')}`),
      }),
      outputSchema: z.object({
        recorded: z.boolean(),
        componentType: z.string().optional(),
        note: z.string().optional(),
      }),
      execute: async (input: VizPlan) => {
        const run = currentRun();
        const profile = run?.resultProfile;
        if (!profile) {
          return { recorded: false, note: 'No result profile is available to visualize.' };
        }

        const resolved = this.vizValidator.validate(input, profile);
        if (run) {
          run.vizPlan = resolved;
          run.vizChoice = resolved.componentType;
        }

        // Table choice records no chart spec — the rows already render as a table.
        if (!resolved.shouldVisualize || resolved.kind === 'table') {
          if (run) run.spec = undefined;
          return {
            recorded: true,
            componentType: 'DataTable',
            note: 'Showing the result as a table — no chart needed.',
          };
        }

        const scope = run?.duckdb;
        if (!scope) {
          return { recorded: false, note: 'No data scope available to shape the chart.' };
        }

        try {
          const spec = await this.jsonCompiler.compile(resolved, scope);
          if (!spec) {
            if (run) run.vizChoice = 'DataTable';
            return { recorded: true, componentType: 'DataTable' };
          }
          const check = this.jsonValidator.validate(spec);
          if (!check.valid) {
            // Fail safe to a table rather than emitting an invalid spec.
            if (run) {
              run.spec = undefined;
              run.vizChoice = 'DataTable';
            }
            return {
              recorded: true,
              componentType: 'DataTable',
              note: `Chart spec rejected (${check.reasons.join('; ')}); showing a table.`,
            };
          }
          if (run) run.spec = spec;
          return { recorded: true, componentType: spec.componentType };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Visualization shaping failed.';
          return { recorded: false, note: message };
        }
      },
    });
  }
}
