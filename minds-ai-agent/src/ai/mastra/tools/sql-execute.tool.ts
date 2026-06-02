import { Injectable, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../../../database/database.module';
import { SqlSafetyService } from '../safety/sql-safety.service';
import { randomUUID } from 'node:crypto';

export type SqlExecutionResult = {
  rows: Record<string, unknown>[];
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  executionMs: number;
  executedSql: string;
};

@Injectable()
export class SqlExecuteHarnessTool {
  constructor(
    @InjectPinoLogger(SqlExecuteHarnessTool.name) private readonly logger: PinoLogger,
    @Inject(DRIZZLE) private readonly db: MySql2Database,
    private readonly sqlSafety: SqlSafetyService,
  ) {}

  async execute(validatedSql: string): Promise<SqlExecutionResult> {
    const check = this.sqlSafety.validate(validatedSql);
    if (!check.valid || !check.readOnly) {
      throw new Error(`SQL failed safety check before execution: ${check.reasons.join('; ')}`);
    }

    const t0 = Date.now();
    const [rawRows] = await this.db.execute(sql.raw(check.normalizedSql ?? validatedSql));
    const rows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
    const executionMs = Date.now() - t0;

    const columns =
      rows.length > 0
        ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
        : [];

    this.logger.info(
      { rowCount: rows.length, executionMs, columnCount: columns.length },
      'SQL executed',
    );

    return {
      rows,
      columns,
      rowCount: rows.length,
      executionMs,
      executedSql: check.normalizedSql ?? validatedSql,
    };
  }
}
