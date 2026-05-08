import type { AgentState } from './agent-state';

export function routeAfterValidation(state: AgentState): string {
  if (state.validationStatus === 'valid') return 'executeSqlCallSystem';
  if (state.validationStatus === 'invalid_recoverable' && (state.retryCount ?? 0) < 2) return 'generateSqlOrToolCall';
  return 'composeFinalResponse';
}

export function routeAfterDecideVisualizationResult(state: AgentState): string {
  return state.suitableForVisualization ? 'renderVisualization' : 'composeFinalResponse';
}
