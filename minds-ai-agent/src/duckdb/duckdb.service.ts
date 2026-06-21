import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DuckDBInstance } from '@duckdb/node-api';

/** Alias the attached read-only MariaDB database is mounted under inside DuckDB. */
export const MARIA_ALIAS = 'maria';

/**
 * Name of the per-run scratch table that holds the retrieved analysis rows. The
 * rows are fetched from MariaDB via Drizzle and loaded here (see
 * DatasetIngestService); the profiler, viz-JSON compiler, and safe-insights
 * service all run their analytical SQL against it.
 */
export const ANALYSIS_DATASET_TABLE = 'analysis_dataset';

/**
 * A per-run DuckDB working scope: a dedicated connection plus a uniquely-named
 * scratch schema that holds the extracted `analysis_dataset`. The DatasetPlan
 * compiler builds `analysis_dataset` here; the profiler, viz-JSON compiler, and
 * safe-insights service all run their analytical SQL against it. Disposed once
 * the analytics run finishes (drops the schema, closes the connection).
 *
 * NestJS-only: `run`/`all` are never exposed to an LLM agent — only the
 * deterministic services call them.
 */
export interface DuckdbRunScope {
  /** Qualified scratch schema name (e.g. `scratch_123`). */
  readonly schema: string;
  /** Execute a statement with no result (DDL / CREATE TABLE AS …). */
  run(sql: string): Promise<void>;
  /** Execute a query and return JS-native row objects. */
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Drop the scratch schema and close the connection. Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Owns the single shared DuckDB instance for the process. On first use it
 * attaches the business MariaDB database in READ-ONLY mode via the DuckDB
 * `mysql` extension, so DuckDB can extract scoped tables/columns for analysis
 * without ever being able to mutate the source database.
 *
 * All analytical execution and visualization-JSON shaping for the analytics
 * pipeline runs here; MariaDB stays a read-only source.
 */
@Injectable()
export class DuckdbService implements OnModuleDestroy {
  private instance?: DuckDBInstance;
  private initPromise?: Promise<void>;
  private scopeSeq = 0;

  constructor(
    @InjectPinoLogger(DuckdbService.name) private readonly logger: PinoLogger,
    private readonly config: ConfigService,
  ) {}

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      // Cache the init promise so concurrent callers share one ATTACH. On
      // failure clear it so the next request can retry (e.g. MariaDB not yet up).
      this.initPromise = this.init().catch((err) => {
        this.initPromise = undefined;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    this.instance = await DuckDBInstance.create(':memory:');
    const conn = await this.instance.connect();
    try {
      // `INSTALL mysql` downloads the loadable extension on first run (needs
      // network once); it is then cached for offline use. `LOAD` must run per
      // connection that queries the attached database.
      await conn.run('INSTALL mysql');
      await conn.run('LOAD mysql');
      await conn.run(
        `ATTACH '${this.buildMariaDsn()}' AS ${MARIA_ALIAS} (TYPE mysql, READ_ONLY)`,
      );
      this.logger.info('DuckDB initialized; MariaDB attached read-only as "%s"', MARIA_ALIAS);
    } finally {
      conn.disconnectSync();
    }
  }

  /** libmysqlclient-style DSN consumed by the DuckDB `mysql` extension. */
  private buildMariaDsn(): string {
    const host = this.config.get<string>('MARIADB_HOST', 'localhost');
    const port = this.config.get<number>('MARIADB_PORT', 3306);
    const user = this.config.get<string>('MARIADB_USER', 'root');
    const password = this.config.get<string>('MARIADB_PASSWORD', '');
    const database = this.config.get<string>('MARIADB_DATABASE', 'minds');
    return [
      `host=${host}`,
      `port=${port}`,
      `user=${user}`,
      password ? `password=${password}` : '',
      `database=${database}`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Run a one-off read query (e.g. information_schema introspection). Opens a
   * transient connection with the mysql extension loaded.
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    await this.ensureInit();
    const conn = await this.instance!.connect();
    await conn.run('LOAD mysql');
    try {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjectsJS() as T[];
    } finally {
      conn.disconnectSync();
    }
  }

  /** Create a per-run scratch scope (dedicated connection + scratch schema). */
  async createScope(): Promise<DuckdbRunScope> {
    await this.ensureInit();
    const conn = await this.instance!.connect();
    await conn.run('LOAD mysql');
    const schema = `scratch_${process.pid}_${Date.now()}_${this.scopeSeq++}`;
    await conn.run(`CREATE SCHEMA ${schema}`);

    let disposed = false;
    return {
      schema,
      run: async (sql: string) => {
        await conn.run(sql);
      },
      all: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
        const reader = await conn.runAndReadAll(sql);
        return reader.getRowObjectsJS() as T[];
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        try {
          await conn.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } catch (err) {
          this.logger.warn({ err }, 'failed to drop DuckDB scratch schema %s', schema);
        } finally {
          try {
            conn.disconnectSync();
          } catch {
            /* connection already closed */
          }
        }
      },
    };
  }

  onModuleDestroy(): void {
    try {
      this.instance?.closeSync();
    } catch {
      /* instance already closed */
    }
  }
}
