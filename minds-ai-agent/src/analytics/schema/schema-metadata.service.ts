import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DuckdbService, MARIA_ALIAS } from '../../duckdb/duckdb.service';
import {
  classifySemanticType,
  findColumn,
  findTable,
  isLatName,
  isLngName,
  type ColumnMeta,
  type SchemaCatalog,
} from './schema-metadata.types';

interface InfoSchemaRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | bigint | null;
}

/**
 * Introspects the read-only attached MariaDB via DuckDB's `information_schema`
 * and produces a typed {@link SchemaCatalog}. This replaces the loose string
 * whitelist previously parsed out of LightRAG context: the DatasetPlan validator
 * checks identifier validity here, and the profiler uses the semantic types.
 *
 * Cached per process (schema rarely changes during a server's lifetime); call
 * {@link refresh} to rebuild after a migration.
 */
@Injectable()
export class SchemaMetadataService implements OnModuleInit {
  private cache?: SchemaCatalog;

  constructor(
    @InjectPinoLogger(SchemaMetadataService.name) private readonly logger: PinoLogger,
    private readonly duckdb: DuckdbService,
  ) {}

  /** Warm the catalog at startup so the plan agent's prompt has typed fields. */
  async onModuleInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      // MariaDB may not be reachable yet at boot; refresh lazily on first use.
      this.logger.warn({ err }, 'schema catalog warm-up deferred');
    }
  }

  async getCatalog(): Promise<SchemaCatalog> {
    if (this.cache) return this.cache;
    return this.refresh();
  }

  async refresh(): Promise<SchemaCatalog> {
    const rows = await this.duckdb.query<InfoSchemaRow>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable, character_maximum_length
         FROM information_schema.columns
        WHERE table_catalog = '${MARIA_ALIAS}'
        ORDER BY table_name, ordinal_position`,
    );

    const byTable = new Map<string, { schema: string; columns: ColumnMeta[] }>();
    for (const r of rows) {
      const maxLen =
        r.character_maximum_length == null ? null : Number(r.character_maximum_length);
      const col: ColumnMeta = {
        name: r.column_name,
        sqlType: r.data_type,
        semanticType: classifySemanticType(r.column_name, r.data_type, maxLen),
        nullable: String(r.is_nullable).toUpperCase() === 'YES',
      };
      const entry = byTable.get(r.table_name) ?? { schema: r.table_schema, columns: [] };
      entry.columns.push(col);
      byTable.set(r.table_name, entry);
    }

    const catalog: SchemaCatalog = [...byTable.entries()].map(([table, entry]) => ({
      table,
      schema: entry.schema,
      columns: entry.columns,
    }));
    this.cache = catalog;
    this.logger.info('schema catalog built: %d tables', catalog.length);
    return catalog;
  }

  async hasTable(table: string): Promise<boolean> {
    return !!findTable(await this.getCatalog(), table);
  }

  async getColumn(table: string, column: string): Promise<ColumnMeta | undefined> {
    return findColumn(await this.getCatalog(), table, column);
  }

  /** Does the table expose a usable latitude + longitude column pair? */
  async geoPair(
    table: string,
  ): Promise<{ latField: string; lngField: string } | undefined> {
    const meta = findTable(await this.getCatalog(), table);
    if (!meta) return undefined;
    const lat = meta.columns.find((c) => c.semanticType === 'geo' && isLatName(c.name));
    const lng = meta.columns.find((c) => c.semanticType === 'geo' && isLngName(c.name));
    return lat && lng ? { latField: lat.name, lngField: lng.name } : undefined;
  }

  /**
   * Compact, LLM-safe rendering of the catalog (names + semantic types only) for
   * injection into the DatasetPlan agent's prompt.
   */
  async promptBlock(): Promise<string> {
    return renderPromptBlock(await this.getCatalog());
  }

  /** Synchronous prompt block from the warm cache, or undefined if not loaded. */
  cachedPromptBlock(): string | undefined {
    return this.cache ? renderPromptBlock(this.cache) : undefined;
  }
}

function renderPromptBlock(catalog: SchemaCatalog): string {
  return catalog
    .map(
      (t) =>
        `- ${t.table}: ${t.columns.map((c) => `${c.name} (${c.semanticType})`).join(', ')}`,
    )
    .join('\n');
}
