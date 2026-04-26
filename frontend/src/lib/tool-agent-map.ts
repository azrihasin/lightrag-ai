/**
 * Maps tool names to the agent that owns them.
 * Reflects the 3-phase pipeline in chat_routes.py:
 *   Phase 1 – Data Gathering Agent  (strategy_agent)
 *   Phase 2 – UI Discovery Agent    (fast_ui_component_retrieve)
 *   Phase 3 – Visualization         (RFC 6902 patches emitted directly)
 */
const TOOL_AGENT_MAP: Record<string, string> = {
  // Phase 1 – Data Gathering Agent
  synthesize_gathered_data: "Data Gathering Agent",
  search: "Data Gathering Agent",
  calculator: "Data Gathering Agent",
  multiply_numbers: "Data Gathering Agent",
  retrieval_agent_tool: "Data Gathering Agent",
  // SQL Query Maker Agent (sub-agent with sql_query_maker_tool)
  create_sql_agent_tool: "SQL Query Maker Agent",

  // Phase 2 – UI Discovery Agent
  lightrag_ui_component_retrieve: "UI Discovery Agent",

  // Phase 2.5 – Normalization Agent
  normalize_data: "Normalization Agent",
};

export function getAgentForTool(toolName: string): string | undefined {
  return TOOL_AGENT_MAP[toolName];
}
