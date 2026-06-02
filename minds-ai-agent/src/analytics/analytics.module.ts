import { Module } from '@nestjs/common';
import { AiMastraModule } from '../ai/mastra/ai-mastra.module';
import { ModelProvider } from '../chat/providers/model.provider';
import { ContextAgentService } from './context-agent.service';
import { TextToVizWorkflow } from './text-to-viz.workflow';
import { AnalyticsAgentService } from './analytics-agent.service';
import { AnalyticsWorkflowTool } from '../ai/mastra/tools/analytics-workflow.tool';
import { IntentAgentService } from './agents/intent.agent';
import { ContextAgentNetworkService } from './agents/context.agent';
import { GenerateSqlAgentService } from './agents/generate-sql.agent';
import { ValidateSqlAgentService } from './agents/validate-sql.agent';
import { ExecuteSqlAgentService } from './agents/execute-sql.agent';
import { SummarizeAgentService } from './agents/summarize.agent';
import { VisualizationAgentService } from './agents/visualization.agent';

@Module({
  imports: [AiMastraModule],
  providers: [
    ModelProvider,
    ContextAgentService,
    TextToVizWorkflow,
    AnalyticsWorkflowTool,
    // Multi-agent network subagents
    IntentAgentService,
    ContextAgentNetworkService,
    GenerateSqlAgentService,
    ValidateSqlAgentService,
    ExecuteSqlAgentService,
    SummarizeAgentService,
    VisualizationAgentService,
    AnalyticsAgentService,
  ],
  exports: [TextToVizWorkflow, AnalyticsAgentService],
})
export class AnalyticsModule {}
