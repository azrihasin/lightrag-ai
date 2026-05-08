import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ModelProvider } from './providers/model.provider';
import { ToolRegistry } from './tools/tool-registry';
import { RetrieveContextTool } from './tools/retrieve-context.tool';
import { AnswerFromContextTool } from './tools/answer-from-context.tool';
import { ClarificationRequestTool } from './tools/clarification-request.tool';
import { GenerateSqlTool } from './tools/generate-sql.tool';
import { ValidateSqlTool } from './tools/validate-sql.tool';
import { ExecuteSqlTool } from './tools/execute-sql.tool';
import { GenerateActionTool } from './tools/generate-action.tool';
import { ValidateActionTool } from './tools/validate-action.tool';
import { ExecuteSystemActionTool } from './tools/execute-system-action.tool';
import { PrepareVisualizationTool } from './tools/prepare-visualization.tool';
import { RenderVisualizationTool } from './tools/render-visualization.tool';
import { HumanReviewGateTool } from './tools/human-review-gate.tool';
import { SummarizeResultTool } from './tools/summarize-result.tool';
import { ComposeResponseTool } from './tools/compose-response.tool';
import { SearchTool } from './tools/search.tool';
import { CalculatorTool } from './tools/calculator.tool';

@Module({
  controllers: [ChatController],
  providers: [
    RetrieveContextTool,
    AnswerFromContextTool,
    ClarificationRequestTool,
    GenerateSqlTool,
    ValidateSqlTool,
    ExecuteSqlTool,
    GenerateActionTool,
    ValidateActionTool,
    ExecuteSystemActionTool,
    PrepareVisualizationTool,
    RenderVisualizationTool,
    HumanReviewGateTool,
    SummarizeResultTool,
    ComposeResponseTool,
    SearchTool,
    CalculatorTool,
    ToolRegistry,
    ModelProvider,
    ChatService,
  ],
})
export class ChatModule {}
