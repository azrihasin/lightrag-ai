import {
  Controller,
  Post,
  Param,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Express } from 'express';
import { FileStoreService, readerExpression } from './file-store.service';
import { validateReadOnlySql } from '../analytics/agents/validate-sql.agent';
import { DuckdbService } from '../duckdb/duckdb.service';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(','));
  return lines.join('\n');
}

@ApiTags('files')
@Controller('api/files')
export class FilesController {
  constructor(
    private readonly fileStore: FileStoreService,
    private readonly duckdb: DuckdbService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload a data file (CSV, JSON, XLSX, Parquet) for the code-interpreter analyze_data tool',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        threadId: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('threadId') threadId?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded (expected multipart field "file")');

    try {
      const record = await this.fileStore.save(
        file.buffer,
        file.originalname,
        file.mimetype,
        threadId ?? 'anonymous',
      );
      return {
        fileId: record.fileId,
        filename: record.originalName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        columns: record.preview.columns,
        rowCount: record.preview.rowCount,
        sampleRows: record.preview.sampleRows,
      };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Failed to process upload');
    }
  }

  @Post(':fileId/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-run a read-only DuckDB SELECT against an uploaded file and download the result as CSV',
    description: 'The SQL must reference the loaded table as "t" and be a read-only SELECT/WITH.',
  })
  @ApiBody({ schema: { type: 'object', required: ['sql'], properties: { sql: { type: 'string' } } } })
  async export(
    @Param('fileId') fileId: string,
    @Body('sql') sql: string,
    @Res() res: Response,
  ): Promise<void> {
    const record = this.fileStore.get(fileId);
    if (!record) throw new NotFoundException(`No uploaded file found for fileId ${fileId}`);

    const safety = validateReadOnlySql(sql ?? '');
    if (!safety.valid) throw new BadRequestException(safety.reason ?? 'Query failed read-only validation');

    const scope = await this.duckdb.createScope();
    try {
      await scope.run(`CREATE TABLE t AS SELECT * FROM ${readerExpression(record)}`);
      const rows = await scope.all(sql);
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${record.fileId}-export.csv"`);
      res.send(csv);
    } finally {
      await scope.dispose();
    }
  }
}
