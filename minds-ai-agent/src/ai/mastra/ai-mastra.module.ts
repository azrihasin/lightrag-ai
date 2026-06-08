import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ModelProvider } from '../../chat/providers/model.provider';
import { SqlSafetyService } from './safety/sql-safety.service';
import { JsonRenderSchemaService } from './visualization/json-render.schema';
import { LancedbRetrievalTool } from './tools/lancedb-retrieve.tool';
import { SqlExecuteHarnessTool } from './tools/sql-execute.tool';
import { SqlAgentService } from './agents/sql.agent';

@Module({
  imports: [DatabaseModule],
  providers: [
    ModelProvider,
    SqlSafetyService,
    JsonRenderSchemaService,
    LancedbRetrievalTool,
    SqlExecuteHarnessTool,
    SqlAgentService,
  ],
  exports: [
    SqlSafetyService,
    JsonRenderSchemaService,
    LancedbRetrievalTool,
    SqlExecuteHarnessTool,
    SqlAgentService,
  ],
})
export class AiMastraModule {}
