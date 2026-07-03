import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as XLSX from 'xlsx';
import { DuckdbService } from '../duckdb/duckdb.service';

export type DuckdbReaderKind = 'csv' | 'json' | 'parquet';

export interface FilePreview {
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

export interface FileRecord {
  fileId: string;
  threadId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** Absolute path DuckDB actually reads (spreadsheets are converted to JSON on upload). */
  storedPath: string;
  readerKind: DuckdbReaderKind;
  uploadedAt: Date;
  preview: FilePreview;
}

const EXTENSION_READERS: Record<string, DuckdbReaderKind> = {
  '.csv': 'csv',
  '.json': 'json',
  '.parquet': 'parquet',
  '.xlsx': 'json', // converted to JSON on upload
  '.xls': 'json',
};

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** DuckDB SQL string literal for a filesystem path (forward slashes, escaped quotes). */
function pathLiteral(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

/** The `read_xxx_auto(...)` table function expression DuckDB uses to load a file. */
export function readerExpression(record: Pick<FileRecord, 'readerKind' | 'storedPath'>): string {
  const lit = pathLiteral(record.storedPath);
  switch (record.readerKind) {
    case 'csv':
      return `read_csv_auto(${lit})`;
    case 'parquet':
      return `read_parquet(${lit})`;
    case 'json':
    default:
      return `read_json_auto(${lit})`;
  }
}

/**
 * Owns uploaded analysis files: validates the extension, stores the raw bytes
 * (or a DuckDB-readable JSON conversion for spreadsheets) under a per-thread
 * scratch directory, and keeps an in-memory registry so the analyze_data tool
 * and export endpoint can resolve a `fileId` back to a DuckDB-readable source.
 * Uploads are scratch data, not persisted app state — a background sweep drops
 * anything older than {@link MAX_AGE_MS}.
 */
@Injectable()
export class FileStoreService implements OnModuleDestroy {
  private readonly registry = new Map<string, FileRecord>();
  private readonly baseDir = path.join(os.tmpdir(), 'minds-uploads');
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    @InjectPinoLogger(FileStoreService.name) private readonly logger: PinoLogger,
    private readonly duckdb: DuckdbService,
  ) {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch((err) => this.logger.warn({ err }, 'file upload cleanup failed'));
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  async save(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    threadId: string,
  ): Promise<FileRecord> {
    const ext = path.extname(originalName).toLowerCase();
    const readerKind = EXTENSION_READERS[ext];
    if (!readerKind) {
      throw new Error(
        `Unsupported file type "${ext || originalName}". Supported: .csv, .json, .xlsx, .xls, .parquet`,
      );
    }

    const fileId = randomUUID();
    const dir = path.join(this.baseDir, threadId || 'anonymous');
    await fs.mkdir(dir, { recursive: true });

    let storedPath: string;
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      storedPath = path.join(dir, `${fileId}.json`);
      await fs.writeFile(storedPath, JSON.stringify(rows));
    } else {
      storedPath = path.join(dir, `${fileId}${ext}`);
      await fs.writeFile(storedPath, buffer);
    }

    const record: FileRecord = {
      fileId,
      threadId: threadId || 'anonymous',
      originalName,
      mimeType,
      sizeBytes: buffer.byteLength,
      storedPath,
      readerKind,
      uploadedAt: new Date(),
      preview: { columns: [], rowCount: 0, sampleRows: [] },
    };
    record.preview = await this.buildPreview(record);

    this.registry.set(fileId, record);
    this.logger.info({ fileId, threadId, originalName }, 'Uploaded file registered');
    return record;
  }

  /**
   * Register a dataset the user pasted as raw JSON into the chat (an array of
   * objects, or a single object). Stored the same way as an uploaded `.json`
   * file so the analyze_data tool resolves it by fileId identically. The name is
   * prefixed `pasted-` so downstream code can tell inline JSON from a real file.
   */
  async saveJsonRows(
    rows: Record<string, unknown>[],
    threadId: string,
    label = 'dataset',
  ): Promise<FileRecord> {
    const fileId = randomUUID();
    const dir = path.join(this.baseDir, threadId || 'anonymous');
    await fs.mkdir(dir, { recursive: true });
    const storedPath = path.join(dir, `${fileId}.json`);
    const serialized = JSON.stringify(rows);
    await fs.writeFile(storedPath, serialized);

    const record: FileRecord = {
      fileId,
      threadId: threadId || 'anonymous',
      originalName: `pasted-${label}.json`,
      mimeType: 'application/json',
      sizeBytes: Buffer.byteLength(serialized),
      storedPath,
      readerKind: 'json',
      uploadedAt: new Date(),
      preview: { columns: [], rowCount: 0, sampleRows: [] },
    };
    record.preview = await this.buildPreview(record);

    this.registry.set(fileId, record);
    this.logger.info({ fileId, threadId, rows: rows.length }, 'Pasted JSON dataset registered');
    return record;
  }

  get(fileId: string): FileRecord | undefined {
    return this.registry.get(fileId);
  }

  private async buildPreview(record: FileRecord): Promise<FilePreview> {
    const expr = readerExpression(record);
    const sampleRows = await this.duckdb.query<Record<string, unknown>>(
      `SELECT * FROM ${expr} LIMIT 20`,
    );
    const [countRow] = await this.duckdb.query<{ c: number | bigint }>(
      `SELECT COUNT(*) AS c FROM ${expr}`,
    );
    const columns =
      sampleRows.length > 0
        ? Object.entries(sampleRows[0]).map(([name, val]) => ({ name, type: typeof val }))
        : [];
    return {
      columns,
      rowCount: Number(countRow?.c ?? 0),
      sampleRows,
    };
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [fileId, record] of this.registry) {
      if (now - record.uploadedAt.getTime() > MAX_AGE_MS) {
        this.registry.delete(fileId);
        await fs.rm(record.storedPath, { force: true }).catch(() => {});
      }
    }
  }
}
