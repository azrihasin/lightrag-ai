/**
 * Maps tool names to the agent that owns them.
 * Reflects the minds-ai-agent pipeline (chat.service.ts / tool-registry.ts):
 *   Phase 1 – Context & Clarification  (retrieve_context, answer_from_context, clarification_request, generic_search, calculator)
 *   Phase 2 – SQL / Action             (generate_sql, validate_sql, execute_sql, generate_action, validate_action, execute_system_action)
 *   Phase 3 – Result & Visualization   (inspect_result, prepare_visualization_data, render_visualization)
 *   Phase 4 – Review & Response        (human_review_gate, summarize_result, compose_final_response)
 */
const TOOL_AGENT_MAP: Record<string, string> = {
  // Phase 1 – Context & Clarification
  retrieve_context: "Context Retrieval Agent",
  answer_from_context: "Context Retrieval Agent",
  clarification_request: "Clarification Agent",
  generic_search: "Search Agent",
  calculator: "Calculator",

  // Phase 2 – SQL / Action
  generate_sql: "SQL Query Maker Agent",
  validate_sql: "SQL Query Maker Agent",
  execute_sql: "SQL Execution Agent",
  generate_action: "Action Agent",
  validate_action: "Action Agent",
  execute_system_action: "Action Agent",

  // Phase 3 – Result & Visualization
  inspect_result: "Result Inspector",
  prepare_visualization_data: "Visualization Agent",
  render_visualization: "Visualization Agent",

  // Phase 4 – Review & Response
  human_review_gate: "Human Review",
  summarize_result: "Summary Agent",
  compose_final_response: "Response Composer",
};

export function getAgentForTool(toolName: string): string | undefined {
  return TOOL_AGENT_MAP[toolName];
}
