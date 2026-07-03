import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import { ANALYSIS_DATASET_TABLE, type DuckdbRunScope } from '../../duckdb/duckdb.service';
import { DatasetIngestService } from '../profile/dataset-ingest.service';
import { ResultProfilerService } from '../profile/result-profiler.service';
import { SafeInsightsService } from '../profile/safe-insights.service';
import { validateReadOnlySql } from './validate-sql.agent';
import type { ResultProfile } from '../profile/result-profile.types';

/** Logical name the interpreter SQL references; mapped to the scoped physical table. */
const SOURCE_VIEW = 'data';

function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Compact, metadata-only rendering of the current dataset for the agent prompt. */
function renderProfile(profile: ResultProfile): string {
  const cols = profile.columns
    .map(
      (c) =>
        `  - ${c.name} [${c.role}/${c.semanticType}] cardinality:${c.cardinalityBucket}` +
        (c.min != null ? ` min:${c.min} max:${c.max}` : ''),
    )
    .join('\n');
  return [`rows: ${profile.rowCount}, columns: ${profile.columnCount}`, 'columns:', cols].join('\n');
}

/**
 * Optional pipeline subagent — analyze_dataset. Runs BETWEEN execute_sql and
 * plan_visualization when the question needs computation beyond the raw query
 * (statistics, derived columns, re-aggregation, cleaning, outlier filtering,
 * ranking, pivoting). It transforms the already-retrieved `analysis_dataset` in
 * the per-run DuckDB scope, then re-ingests + re-profiles the result so the
 * downstream visualization/summary steps operate on the analyzed dataset.
 *
 * Privacy: like the rest of the pipeline the LLM sees ONLY column metadata + row
 * counts — never row values. It writes DuckDB SQL against the `data` view from
 * the metadata alone; the transformed rows travel out-of-band on the blackboard.
 */
@Injectable()
export class AnalyzeDatasetAgentService {
  readonly agent: Agent;

  constructor(
    @InjectPinoLogger(AnalyzeDatasetAgentService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly ingest: DatasetIngestService,
    private readonly profiler: ResultProfilerService,
    private readonly safeInsights: SafeInsightsService,
  ) {
    this.agent = new Agent({
      id: 'analyze_dataset',
      name: 'AnalyzeDatasetAgent',
      description:
        'Optionally transform/clean/aggregate the retrieved dataset in DuckDB before visualization: ' +
        'compute statistics, derive columns, re-aggregate, filter outliers, rank, or pivot. Run AFTER ' +
        'execute_sql and BEFORE plan_visualization, ONLY when the question needs computation beyond the ' +
        'raw query result.',
      instructions: () => {
        const run = currentRun();
        const profile = run?.resultProfile;
        const profileBlock = profile
          ? `\n\n---\n\n## Current dataset (metadata only — no row values)\n${renderProfile(profile)}`
          : '';
        return (
          [
            'You are a data analyst working in DuckDB SQL. The retrieved dataset is available as the',
            `view \`${SOURCE_VIEW}\`. You see ONLY column metadata (names, roles, types) — never row values.`,
            '',
            'Begin your reply with ONE short sentence (e.g. "Computing the requested breakdown.").',
            'Decide whether the question needs a transformation beyond what the query already returned',
            '(e.g. group + aggregate, compute averages/rates/percentiles, derive a column, rank, filter',
            `outliers, pivot). If YES: use preview_analysis to check a read-only SELECT over \`${SOURCE_VIEW}\``,
            'as many times as you need, then call apply_analysis ONCE with the final SELECT — that becomes',
            'the dataset the visualization and summary use.',
            'If NO transformation is needed (the raw result already answers the question), say so briefly',
            'and do NOT call apply_analysis — leave the dataset unchanged.',
            `Reference ONLY the columns listed below, and read only from \`${SOURCE_VIEW}\`. Queries must be`,
            'read-only SELECT/WITH statements.',
          ].join('\n') + profileBlock
        );
      },
      model: this.modelProvider.getModel() as any,
      tools: {
        preview_analysis: this.previewTool(),
        apply_analysis: this.applyTool(),
      },
    });
  }

  /** (Re)create the `data` view mapping the logical name to the scoped physical table. */
  private async ensureView(scope: DuckdbRunScope): Promise<void> {
    const table = `${q(scope.schema)}.${q(ANALYSIS_DATASET_TABLE)}`;
    await scope.run(`CREATE OR REPLACE TEMP VIEW ${q(SOURCE_VIEW)} AS SELECT * FROM ${table}`);
  }

  private previewTool() {
    return createTool({
      id: 'preview_analysis',
      description: `Run a read-only DuckDB SELECT over \`${SOURCE_VIEW}\` and report the row count + columns (no row values).`,
      inputSchema: z.object({ sql: z.string().describe(`A read-only SELECT/WITH over \`${SOURCE_VIEW}\``) }),
      outputSchema: z.object({
        ok: z.boolean(),
        error: z.string().optional(),
        rowCount: z.number().optional(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
      }),
      execute: async ({ sql }: { sql: string }) => {
        const run = currentRun();
        const scope = run?.duckdb;
        if (!scope) return { ok: false, error: 'No dataset scope is available to analyze.' };
        const safety = validateReadOnlySql(sql);
        if (!safety.valid) return { ok: false, error: safety.reason };
        try {
          await this.ensureView(scope);
          const rows = await scope.all<Record<string, unknown>>(sql);
          const columns =
            rows.length > 0
              ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
              : [];
          return { ok: true, rowCount: rows.length, columns };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Preview query failed.' };
        }
      },
    });
  }

  private applyTool() {
    return createTool({
      id: 'apply_analysis',
      description:
        `Apply the final read-only DuckDB SELECT over \`${SOURCE_VIEW}\` as the analyzed dataset. Its result ` +
        'replaces the dataset used by the visualization and summary steps.',
      inputSchema: z.object({ sql: z.string().describe(`The final read-only SELECT/WITH over \`${SOURCE_VIEW}\``) }),
      outputSchema: z.object({
        ok: z.boolean(),
        error: z.string().optional(),
        rowCount: z.number().optional(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
      }),
      execute: async ({ sql }: { sql: string }) => {
        const run = currentRun();
        const scope = run?.duckdb;
        if (!run || !scope) return { ok: false, error: 'No dataset scope is available to analyze.' };
        const safety = validateReadOnlySql(sql);
        if (!safety.valid) return { ok: false, error: safety.reason };

        try {
          await this.ensureView(scope);
          // Fetch the transformed rows into JS FIRST (still reading the old
          // analysis_dataset via the view), then re-ingest to replace it.
          const rows = await scope.all<Record<string, unknown>>(sql);
          const columns =
            rows.length > 0
              ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
              : [];

          const outputs = await this.ingest.ingest(scope, columns, rows);
          run.datasetOutputs = outputs;
          run.rows = rows;
          run.columns = columns;
          run.rowCount = rows.length;
          run.analysisApplied = true;
          // Re-profile so plan_visualization / summarize_result see the analyzed data.
          run.resultProfile = await this.profiler.profile(scope, outputs);
          run.safeInsights = await this.safeInsights.build(scope, run.resultProfile);

          return { ok: true, rowCount: rows.length, columns };
        } catch (err) {
          this.logger.warn({ err }, 'apply_analysis failed');
          return { ok: false, error: err instanceof Error ? err.message : 'Analysis query failed.' };
        }
      },
    });
  }
}
