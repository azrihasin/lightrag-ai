import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { VdbConversionService } from './vdb-conversion.service';
import { ConvertVdbSchema } from './dto/convert-vdb.dto';

@ApiTags('lancedb')
@Controller('api/lancedb')
export class LanceDbController {
  constructor(private readonly conversionService: VdbConversionService) {}

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convert LightRAG vdb_chunks.json embeddings into a local LanceDB table',
  })
  @ApiResponse({ status: 200, description: 'Conversion completed' })
  @ApiResponse({ status: 400, description: 'Invalid request or source file' })
  async convert(@Body() body: unknown) {
    const parsed = ConvertVdbSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.conversionService.convert(parsed.data);
  }
}
