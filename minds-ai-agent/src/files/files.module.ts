import { Module } from '@nestjs/common';
import { DuckdbModule } from '../duckdb/duckdb.module';
import { FileStoreService } from './file-store.service';
import { FilesController } from './files.controller';

@Module({
  imports: [DuckdbModule],
  controllers: [FilesController],
  providers: [FileStoreService],
  exports: [FileStoreService],
})
export class FilesModule {}
