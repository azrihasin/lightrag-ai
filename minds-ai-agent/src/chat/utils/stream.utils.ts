import type { AgentState } from './agent-state';

export const STREAMING_NODES = new Set([
  'composeFinalResponse',
]);

export const TOOL_STREAMING_NODES = new Set([
  'analyzeUserIntent',
  'decideVisualizationResult',
]);

export function resolveToolName(nodeName: string, _state: AgentState): string | undefined {
  switch (nodeName) {
    case 'analyzeUserIntent':         return 'analyze_user_intent';
    case 'retrieveContext':           return 'retrieve_context';
    case 'generateSqlOrToolCall':     return 'generate_sql';
    case 'validateSqlAction':         return 'validate_sql';
    case 'executeSqlCallSystem':      return 'execute_sql';
    case 'decideVisualizationResult': return 'decide_visualization';
    case 'renderVisualization':       return 'render_visualization';
    case 'composeFinalResponse':      return 'compose_final_response';
    default:                          return undefined;
  }
}

export function resolveStartingMessage(nodeName: string, state: AgentState): string {
  const intent = state.userIntent ? `"${state.userIntent}"` : 'the request';
  switch (nodeName) {
    case 'analyzeUserIntent':         return `Reading message and extracting intent…`;
    case 'retrieveContext':           return `Retrieving database schema for ${intent}…`;
    case 'generateSqlOrToolCall':     return `Generating SQL query for ${intent}…`;
    case 'validateSqlAction':         return `Validating SQL query…`;
    case 'executeSqlCallSystem':      return `Executing SQL against the database…`;
    case 'decideVisualizationResult': return `Selecting visualization and building JMESPath query…`;
    case 'renderVisualization':       return `Rendering ${state.visualizationComponentType ?? 'visualization'} component…`;
    case 'composeFinalResponse':      return `Composing final response for ${intent}…`;
    default:                          return `Processing…`;
  }
}

export function extractNodeArgs(nodeName: string, state: AgentState): Record<string, unknown> {
  switch (nodeName) {
    case 'analyzeUserIntent':         return { query: state.messages.at(-1)?.content ?? '' };
    case 'retrieveContext':           return { query: state.userIntent ?? state.messages.at(-1)?.content ?? '', mode: 'mix' };
    case 'generateSqlOrToolCall':     return { intent: state.userIntent, dialect: 'mysql', retry: state.retryCount };
    case 'validateSqlAction':         return { sql: state.generatedSql, dialect: state.sqlDialect };
    case 'executeSqlCallSystem':      return { sql: state.generatedSql };
    case 'decideVisualizationResult': {
      const er = state.executionResult as { columns?: string[]; rowCount?: number } | undefined;
      return { sql: state.generatedSql, columns: er?.columns, rowCount: er?.rowCount };
    }
    case 'renderVisualization':       return { componentType: state.visualizationComponentType, props: state.visualizationProps };
    case 'composeFinalResponse':      return { intent: state.userIntent, hasVisualization: Boolean(state.visualizationPayload) };
    default:                          return {};
  }
}

export function summarizeNodeOutput(nodeName: string, output: Partial<AgentState>): unknown {
  const vizPayload = output.visualizationPayload as Record<string, unknown> | undefined;
  switch (nodeName) {
    case 'analyzeUserIntent':         return { userIntent: output.userIntent };
    case 'retrieveContext': {
      const docs = output.retrievedContext?.documents ?? [];
      return { sufficient: output.retrievedContext?.sufficient, documentCount: docs.length, summary: output.retrievedContext?.contextSummary };
    }
    case 'generateSqlOrToolCall':     return { sql: output.generatedSql, dialect: output.sqlDialect };
    case 'validateSqlAction':         return { status: output.validationStatus, reason: output.validationReason };
    case 'executeSqlCallSystem': {
      const er = output.executionResult as { columns?: string[]; rowCount?: number; durationMs?: number; success?: boolean } | undefined;
      return { rowCount: er?.rowCount, columns: er?.columns, durationMs: er?.durationMs, success: er?.success };
    }
    case 'decideVisualizationResult': return { suitable: output.suitableForVisualization, component: output.visualizationComponentType, jmespathQuery: output.visualizationJmespathQuery };
    case 'renderVisualization':       return { rendered: vizPayload !== undefined, componentType: vizPayload?.componentType };
    case 'composeFinalResponse':      return { responseLength: output.finalResponse?.length ?? 0 };
    default:                          return output;
  }
}
