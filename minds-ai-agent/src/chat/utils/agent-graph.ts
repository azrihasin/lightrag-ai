import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import type { CompiledStateGraph } from '@langchain/langgraph';
import type { PinoLogger } from 'nestjs-pino';
import type { ModelProvider } from '../providers/model.provider';
import { AgentStateSchema } from './agent-state';
import type { AgentState, ToolMap } from './agent-state';
import { buildNodes } from './agent-nodes';
import { routeAfterValidation, routeAfterDecideVisualizationResult } from './agent-edges';

// Pipeline: analyzeUserIntent → retrieveContext (schema) → generateSqlOrToolCall → validateSqlAction
//           → executeSqlCallSystem (data table) → decideVisualizationResult (JMESPath)
//           → renderVisualization → composeFinalResponse → streamFinalResponse

export function buildGraph(toolMap: ToolMap, logger: PinoLogger, modelProvider: ModelProvider): CompiledStateGraph<AgentState, Partial<AgentState>> {
  const nodes = buildNodes(toolMap, logger, modelProvider);

  const workflow = new StateGraph(AgentStateSchema)
    .addNode('analyzeUserIntent',         nodes.analyzeUserIntent)
    .addNode('retrieveContext',           nodes.retrieveContext)
    .addNode('generateSqlOrToolCall',     nodes.generateSqlOrToolCall)
    .addNode('validateSqlAction',         nodes.validateSqlAction)
    .addNode('executeSqlCallSystem',      nodes.executeSqlCallSystem)
    .addNode('decideVisualizationResult', nodes.decideVisualizationResult)
    .addNode('renderVisualization',       nodes.renderVisualization)
    .addNode('composeFinalResponse',      nodes.composeFinalResponse)
    .addNode('streamFinalResponse',       nodes.streamFinalResponse)

    .addEdge(START,                       'analyzeUserIntent')
    .addEdge('analyzeUserIntent',         'retrieveContext')
    .addEdge('retrieveContext',           'generateSqlOrToolCall')
    .addEdge('generateSqlOrToolCall',     'validateSqlAction')
    .addEdge('executeSqlCallSystem',      'decideVisualizationResult')
    .addEdge('renderVisualization',       'composeFinalResponse')
    .addEdge('composeFinalResponse',      'streamFinalResponse')
    .addEdge('streamFinalResponse',       END)

    .addConditionalEdges('validateSqlAction', routeAfterValidation, {
      executeSqlCallSystem:  'executeSqlCallSystem',
      generateSqlOrToolCall: 'generateSqlOrToolCall',
      composeFinalResponse:  'composeFinalResponse',
    })
    .addConditionalEdges('decideVisualizationResult', routeAfterDecideVisualizationResult, {
      renderVisualization: 'renderVisualization',
      composeFinalResponse: 'composeFinalResponse',
    });

  const memory = new MemorySaver();
  return workflow.compile({ checkpointer: memory }) as any;
}
