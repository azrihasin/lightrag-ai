import { Module } from '@nestjs/common';
import { LanceDbController } from './lancedb.controller';
import { VdbConversionService } from './vdb-conversion.service';

@Module({
  controllers: [LanceDbController],
  providers: [VdbConversionService],
  exports: [VdbConversionService],
})
export class LanceDbModule {}
