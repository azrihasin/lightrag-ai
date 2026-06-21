import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql as drizzleSql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../database/database.module';
import { DuckdbService } from '../../duckdb/duckdb.service';
import { normalizeRows } from '../../duckdb/duckdb-values';
import { DatasetIngestService } from '../profile/dataset-ingest.service';
import { VizJsonCompiler } from '../viz/viz-json.compiler';
import { validateReadOnlySql } from '../agents/validate-sql.agent';
import type { ResolvedVizPlan } from '../viz/viz-plan.types';
import type { VisualizationSpec } from '../analytics.types';

export interface DatasetRerunResult {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  spec?: VisualizationSpec;
}

/**
 * Re-runs a persisted read-only SQL query on demand (the rerun card). Turns store
 * the executed MariaDB SELECT (+ resolved viz plan) instead of raw data, so the
 * table + chart are rebuilt from a fresh, validated, read-only execution — with
 * no LLM involvement and no row data stored at rest. The rows are retrieved from
 * MariaDB via Drizzle, then ingested into DuckDB only to re-shape the chart spec.
 */
@Injectable()
export class DatasetRerunService {
  constructor(
    @Inject(DRIZZLE) private readonly db: MySql2Database,
    private readonly duckdb: DuckdbService,
    private readonly ingest: DatasetIngestService,
    private readonly vizJson: VizJsonCompiler,
  ) {}

  async reexecute(sql: string, vizPlan?: ResolvedVizPlan): Promise<DatasetRerunResult> {
    const query = sql?.trim();
    const safety = validateReadOnlySql(query ?? '');
    if (!safety.valid) {
      throw new BadRequestException(
        `Stored query can no longer be run: ${safety.reason ?? 'failed read-only validation'}`,
      );
    }

    const [rawRows] = await this.db.execute(drizzleSql.raw(query));
    const rawList = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
    const columns =
      rawList.length > 0
        ? Object.keys(rawList[0]).map((name) => ({ name }))
        : [];
    const rows = normalizeRows(rawList);

    let spec: VisualizationSpec | undefined;
    if (vizPlan?.shouldVisualize && rawList.length > 0) {
      const scope = await this.duckdb.createScope();
      try {
        await this.ingest.ingest(scope, columns, rawList);
        spec = await this.vizJson.compile(vizPlan, scope);
      } finally {
        await scope.dispose();
      }
    }

    return {
      columns: columns.map((c) => ({ name: c.name, type: 'string' })),
      rows,
      rowCount: rows.length,
      spec,
    };
  }
}
