import { promises as fs } from 'fs';
import * as path from 'path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as lancedb from '@lancedb/lancedb';
import type { ConvertVdbDto } from './dto/convert-vdb.dto';

/**
 * Shape of a single entry inside LightRAG's NanoVectorDB `vdb_chunks.json` `data` array.
 * The actual embeddings live in the top-level base64 `matrix`, row-aligned with `data`.
 */
interface VdbChunkItem {
  __id__: string;
  __created_at__: number;
  content: string;
  full_doc_id: string;
  file_path: string;
}

interface VdbChunksFile {
  embedding_dim: number;
  data: VdbChunkItem[];
  /** base64-encoded row-major float32 matrix: data.length × embedding_dim */
  matrix: string;
}

/** One LanceDB row. `vector` is the conventional embedding column name. */
interface LanceChunkRow {
  id: string;
  vector: number[];
  content: string;
  full_doc_id: string;
  file_path: string;
  created_at: number;
}

export interface ConvertResult {
  table: string;
  dbDir: string;
  sourceFile: string;
  rows: number;
  embeddingDim: number;
}

@Injectable()
export class VdbConversionService {
  constructor(
    @InjectPinoLogger(VdbConversionService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Storage root = the minds-ai-agent project dir (cwd when the service runs). */
  private storageRoot(): string {
    return process.cwd();
  }

  private resolveSourceFile(override?: string): string {
    if (override) return path.resolve(override);
    const dir = process.env.RAG_STORAGE_DIR ?? path.join(this.storageRoot(), 'rag_storage');
    return path.join(dir, 'vdb_chunks.json');
  }

  private resolveDbDir(override?: string): string {
    if (override) return path.resolve(override);
    return process.env.LANCEDB_DIR ?? path.join(this.storageRoot(), 'lancedb');
  }

  async convert(dto: ConvertVdbDto = {}): Promise<ConvertResult> {
    const sourceFile = this.resolveSourceFile(dto.sourceFile);
    const dbDir = this.resolveDbDir(dto.dbDir);
    const tableName = dto.tableName ?? 'vdb_chunks';
    const overwrite = dto.overwrite ?? true;

    const parsed = await this.readSource(sourceFile);
    const rows = this.buildRows(parsed);

    // LanceDB convention: a database is a directory; connecting creates it if missing,
    // and each table is persisted as a `<table>.lance` dataset folder inside it.
    await fs.mkdir(dbDir, { recursive: true });
    const db = await lancedb.connect(dbDir);

    await db.createTable(tableName, rows as unknown as Record<string, unknown>[], {
      mode: overwrite ? 'overwrite' : 'create',
    });

    this.logger.info(
      { sourceFile, dbDir, tableName, rows: rows.length, embeddingDim: parsed.embedding_dim },
      'Converted vdb_chunks.json to LanceDB',
    );

    return {
      table: tableName,
      dbDir,
      sourceFile,
      rows: rows.length,
      embeddingDim: parsed.embedding_dim,
    };
  }

  private async readSource(sourceFile: string): Promise<VdbChunksFile> {
    let raw: string;
    try {
      raw = await fs.readFile(sourceFile, 'utf8');
    } catch {
      throw new BadRequestException(`Source file not found or unreadable: ${sourceFile}`);
    }

    let parsed: VdbChunksFile;
    try {
      parsed = JSON.parse(raw) as VdbChunksFile;
    } catch {
      throw new BadRequestException(`Source file is not valid JSON: ${sourceFile}`);
    }

    if (!Array.isArray(parsed.data) || typeof parsed.matrix !== 'string') {
      throw new BadRequestException(
        'Unexpected vdb_chunks.json shape: expected `data` array and base64 `matrix` string.',
      );
    }
    if (!parsed.embedding_dim || parsed.embedding_dim <= 0) {
      throw new BadRequestException('Missing or invalid `embedding_dim` in source file.');
    }
    return parsed;
  }

  /** Decode the base64 float32 matrix and zip each row with its metadata entry. */
  private buildRows(parsed: VdbChunksFile): LanceChunkRow[] {
    const { data, matrix, embedding_dim } = parsed;
    const buf = Buffer.from(matrix, 'base64');
    const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

    const expected = data.length * embedding_dim;
    if (floats.length !== expected) {
      throw new BadRequestException(
        `Matrix size mismatch: decoded ${floats.length} floats but expected ` +
          `${data.length} rows × ${embedding_dim} dims = ${expected}.`,
      );
    }

    return data.map((item, i) => {
      const start = i * embedding_dim;
      return {
        id: item.__id__,
        vector: Array.from(floats.subarray(start, start + embedding_dim)),
        content: item.content,
        full_doc_id: item.full_doc_id,
        file_path: item.file_path,
        created_at: item.__created_at__,
      };
    });
  }
}
