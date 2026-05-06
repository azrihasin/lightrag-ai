import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Response } from 'express';
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import type { CompiledStateGraph } from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import * as z from 'zod';
import { randomUUID } from 'node:crypto';
import { ModelProvider } from './providers/model.provider';
import { ToolRegistry } from './tools/tool-registry';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { DataSpecPayload } from './dto/sse-event.dto';

// ─── State Schema ─────────────────────────────────────────────────────────────

const AgentStateSchema = z.object({
  messages: z.array(
    z.object({ role: z.enum(['user', 'assistant']), content: z.string() }),
  ),
  userIntent: z.string().optional(),
  strategy: z
    .enum(['direct', 'sql', 'system_tool', 'hybrid', 'unknown', 'data_crosscheck', 'data_passthrough'])
    .optional(),
  userProvidedData: z.any().optional(),
  retrievedContext: z
    .object({
      documents: z.array(z.any()),
      query: z.string(),
      sufficient: z.boolean(),
      contextSummary: z.string().optional(),
    })
    .optional(),
  enoughContext: z.boolean().optional(),
  currentPlan: z.string().optional(),
  needsUserInput: z.boolean().optional(),
  currentActionId: z.string().optional(),
  generatedSql: z.string().optional(),
  sqlDialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional(),
  generatedAction: z.any().optional(),
  retryCount: z.number().default(0),
  validationStatus: z
    .enum(['valid', 'invalid_recoverable', 'invalid_blocking'])
    .optional(),
  validationReason: z.string().optional(),
  isUnsafe: z.boolean().optional(),
  executionResult: z.any().optional(),
  taskComplete: z.boolean().optional(),
  inspectionDataShape: z.any().optional(),
  nextStepDecision: z
    .enum(['another_query', 'another_system', 'human_decision'])
    .optional(),
  suitableForVisualization: z.boolean().optional(),
  visualizationComponentType: z.string().optional(),
  visualizationProps: z.any().optional(),
  visualizationPayload: z.any().optional(),
  summary: z.string().optional(),
  reviewNotes: z.string().optional(),
  finalResponse: z.string().optional(),
});

type AgentState = z.infer<typeof AgentStateSchema>;
type ToolMap = ReturnType<ToolRegistry['getAll']>;

// ─── Custom stream event types ────────────────────────────────────────────────

interface NodeStartEvent {
  type: 'node:start';
  node: string;
  data?: Record<string, unknown>;
}

interface NodeProgressEvent {
  type: 'node:progress';
  node: string;
  step: string;
  data?: unknown;
}

type NodeCustomEvent = NodeStartEvent | NodeProgressEvent;

// ─── Helpers ──────────────────────────────────────────────────────────────────


async function callTool(tools: ToolMap, name: string, input: Record<string, unknown>): Promise<any> {
  return (tools[name] as any).execute(input, { toolCallId: randomUUID(), messages: [] });
}

function parseJsonFromRaw<T>(raw: string, schema: z.ZodType<T>): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM did not return JSON. Got: ${raw.slice(0, 200)}`);
  return schema.parse(JSON.parse(match[0]));
}

function extractDelta(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('');
  }
  return '';
}

async function streamText(
  model: ReturnType<ModelProvider['getChatModel']>,
  messages: (SystemMessage | HumanMessage)[],
  config?: RunnableConfig,
): Promise<string> {
  let text = '';
  for await (const chunk of await model.stream(messages, config)) {
    text += extractDelta(chunk.content);
  }
  return text;
}


/**
 * Write a structured log line to stdout for every streamed graph event.
 * Format: [ISO_TIMESTAMP] [MODE    ] [node_name                   ] payload_json
 */
function terminalLog(mode: string, node: string | undefined, payload: unknown): void {
  const ts = new Date().toISOString();
  const modeCol = mode.padEnd(8);
  const nodeCol = (node ?? '—').padEnd(28);
  process.stdout.write(`[${ts}] [${modeCol}] [${nodeCol}] ${JSON.stringify(payload)}\n`);
}

// ─── Node Factories ────────────────────────────────────────────────────────────

function buildNodes(tools: ToolMap, logger: PinoLogger, modelProvider: ModelProvider) {

  async function analyzeUserIntent(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'analyzeUserIntent' });
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const query = lastUser?.content ?? '';
    const intentModel = modelProvider.getChatModel(['analyzeUserIntent']);
    const userIntent = await streamText(intentModel, [
      new SystemMessage(
        'You are an intent-analysis assistant. Given the user\'s message, write exactly 2 to 3 sentences. ' +
        'First, summarize what the user wants. Then, state what you will do to fulfill the request. ' +
        'Be concise and specific. Reply with plain text only — no JSON, no markdown, no bullet points.',
      ),
      new HumanMessage(`User message: "${query}"`),
    ], config);
    return { userIntent: userIntent.trim() || query };
  }

  async function strategyDecision(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'strategyDecision' });
    const VALID_STRATEGIES = ['direct', 'sql', 'system_tool', 'hybrid', 'unknown', 'data_crosscheck', 'data_passthrough'] as const;
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const userMessage = lastUser?.content ?? '';
    const strategyModel = modelProvider.getChatModel(['strategyDecision']);
    const raw = await streamText(strategyModel, [
      new SystemMessage(
        'Select the best execution strategy for the given intent and user message.\n\n' +
        'STRATEGY OPTIONS:\n' +
        '- "sql"              = needs a database query to retrieve data\n' +
        '- "system_tool"      = needs a calculator, search engine, or external API\n' +
        '- "direct"           = can be answered from general knowledge alone\n' +
        '- "hybrid"           = mixed approach (knowledge + query)\n' +
        '- "data_crosscheck"  = user has included data directly in their message AND wants it\n' +
        '                       validated or cross-referenced against the knowledge base\n' +
        '                       (which contains schema definitions and UI specs)\n' +
        '- "data_passthrough" = user has included data directly in their message AND just wants\n' +
        '                       it processed, visualized, or reformatted — no database query or\n' +
        '                       knowledge-base lookup needed\n' +
        '- "unknown"          = unclear intent\n\n' +
        'DETECTING USER-PROVIDED DATA: Look for inline tables (CSV, markdown tables), JSON arrays/objects,\n' +
        'numbered/bulleted lists of records, or any structured dataset embedded in the message.\n\n' +
        'When strategy is "data_passthrough" or "data_crosscheck", extract the raw data from the user\n' +
        'message and include it as "userProvidedData" in your response (as a JSON array when possible).\n\n' +
        'Use exactly one of these values as the "strategy" key: direct, sql, system_tool, hybrid, unknown, data_crosscheck, data_passthrough.\n\n' +
        'Reply with a single JSON object only. No markdown fences.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\n\nOriginal user message: "${userMessage}"`),
    ], config);
    return parseJsonFromRaw(raw, z.object({
      strategy: z.string().transform((val): typeof VALID_STRATEGIES[number] => {
        const norm = val.toLowerCase().trim() as typeof VALID_STRATEGIES[number];
        return VALID_STRATEGIES.includes(norm) ? norm : 'unknown';
      }),
      userProvidedData: z.any().optional(),
    }));
  }

  async function retrieveContext(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'retrieveContext' });
    const query = state.userIntent ?? state.messages.at(-1)?.content ?? '';
    const result = (await callTool(tools, 'retrieve_context', {
      query,
      mode: 'mix',
      topK: 10,
    })) as { documents: unknown[]; query: string; sufficient: boolean; contextSummary?: string };
    return { retrievedContext: result, enoughContext: result.sufficient };
  }

  async function answerFromLightRAG(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'answerFromLightRAG' });
    const documents = state.retrievedContext?.documents ?? [];
    const contextText = documents
      .map((d) => (d as Record<string, unknown>).content)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .join('\n\n');
    const hasContext = contextText.length > 0;

    const systemPrompt = hasContext
      ? 'You are a knowledgeable assistant. Answer the question using the provided context as your primary source. ' +
        'You may supplement with your general knowledge when the context is incomplete, but clearly prioritise information from the context. ' +
        'Be thorough and informative — do not ask the user for more details.'
      : 'You are a knowledgeable assistant. Answer the question using your general knowledge. ' +
        'Be thorough and informative — do not ask the user for more details.';

    const humanMessage = hasContext
      ? `Question: ${state.userIntent}\n\nContext from knowledge base:\n${contextText}`
      : `Question: ${state.userIntent}`;

    const ragModel = modelProvider.getChatModel(['answerFromLightRAG']);
    const finalResponse = await streamText(ragModel, [new SystemMessage(systemPrompt), new HumanMessage(humanMessage)], config);
    logger.info({ responseLength: finalResponse.length, responsePreview: finalResponse.slice(0, 300) }, 'answerFromLightRAG: LLM output');
    return { finalResponse };
  }

  async function planNextStep(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'planNextStep' });
    const planModel = modelProvider.getChatModel(['planNextStep']);
    const raw = await streamText(planModel, [
      new SystemMessage(
        'Plan the next step for fulfilling the user intent. ' +
        'Set needsUserInput=false for general knowledge questions, broad topic inquiries, or any query where a database or external tool can be attempted. ' +
        'Set needsUserInput=true ONLY when a specific required value (e.g. account ID, date range, or secret credential) is completely unknown and cannot be inferred or assumed. ' +
        'When in doubt, prefer needsUserInput=false and attempt to answer or query.' +
        '\n\nReply with a single JSON object only. No markdown fences.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\nStrategy: "${state.strategy}"\nContext available: "${state.retrievedContext?.contextSummary ?? 'none'}"`),
    ], config);
    return parseJsonFromRaw(raw, z.object({
      currentPlan: z.string().optional().default('').describe('One-sentence plan for the next action'),
      needsUserInput: z.boolean().optional().default(false).describe('true ONLY if a specific required value is completely missing and cannot be assumed'),
    }));
  }

  async function disambiguateAskUser(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'disambiguateAskUser' });
    const disambiguateModel = modelProvider.getChatModel(['disambiguateAskUser']);
    const finalResponse = await streamText(disambiguateModel, [
      new SystemMessage(
        'Generate a concise, specific clarification question for the user. ' +
          'Do not answer the question — only ask for the missing information.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\nPlan: "${state.currentPlan ?? 'none'}"`),
    ], config);
    return { finalResponse };
  }

  async function generateSqlOrToolCall(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'generateSqlOrToolCall' });
    const retryCount = (state.retryCount ?? 0) + (state.validationStatus != null ? 1 : 0);

    if (state.strategy === 'sql') {
      const contextDocs = state.retrievedContext?.documents ?? [];
      const schemaContext = contextDocs
        .map((d: any) => (typeof d.content === 'string' ? d.content : ''))
        .filter((c: string) => c.trim().length > 0)
        .join('\n\n---\n\n');
      const schemaHint = schemaContext || state.retrievedContext?.contextSummary;

      try {
        const result = (await callTool(tools, 'generate_sql', {
          intent: state.userIntent ?? '',
          dialect: 'mysql',
          schemaHint,
          rationale: state.currentPlan,
        })) as { actionId: string; sql: string; dialect: string };
        (config as any)?.writer?.({ type: 'node:progress', node: 'generateSqlOrToolCall', step: 'sql-query', data: { sql: result.sql, dialect: result.dialect } });
        return { currentActionId: result.actionId, generatedSql: result.sql, sqlDialect: result.dialect as AgentState['sqlDialect'], generatedAction: undefined, retryCount };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'SQL generation failed';
        logger.warn({ reason }, 'generateSqlOrToolCall: SQL generation blocked');
        return {
          currentActionId: randomUUID(),
          generatedSql: undefined,
          generatedAction: undefined,
          validationStatus: 'invalid_blocking' as AgentState['validationStatus'],
          validationReason: reason,
          isUnsafe: false,
          retryCount,
        };
      }
    }

    const systemMap: Record<string, string> = { system_tool: 'calculator', hybrid: 'generic_search', direct: 'generic_search', unknown: 'generic_search' };
    const result = (await callTool(tools, 'generate_action', {
      intent: state.userIntent ?? '',
      system: systemMap[state.strategy ?? 'unknown'] ?? 'generic_search',
      params: { query: state.userIntent },
      rationale: state.currentPlan,
    })) as { actionId: string; toolName: string; input: Record<string, unknown> };
    return { currentActionId: result.actionId, generatedAction: result, generatedSql: undefined, retryCount };
  }

  async function validateSqlAction(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'validateSqlAction' });

    // Generation already failed — validationStatus is pre-set; skip re-validation
    if (!state.generatedSql && !state.generatedAction) {
      return {};
    }

    if (state.generatedSql) {
      const result = (await callTool(tools, 'validate_sql', {
        actionId: state.currentActionId ?? randomUUID(),
        sql: state.generatedSql,
        dialect: state.sqlDialect ?? 'postgres',
      })) as { status: string; reason: string; riskLevel: string };
      return { validationStatus: result.status as AgentState['validationStatus'], validationReason: result.reason, isUnsafe: result.riskLevel === 'high' };
    }

    const action = state.generatedAction as { actionId: string; toolName: string; input: Record<string, unknown> };
    const result = (await callTool(tools, 'validate_action', {
      actionId: action.actionId,
      toolName: action.toolName,
      input: action.input,
    })) as { status: string; reason: string };
    return { validationStatus: result.status as AgentState['validationStatus'], validationReason: result.reason };
  }

  async function executeSqlCallSystem(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'executeSqlCallSystem' });
    if (state.generatedSql) {
      const result = await callTool(tools, 'execute_sql', { actionId: state.currentActionId ?? randomUUID(), sql: state.generatedSql });
      return { executionResult: result };
    }

    const action = state.generatedAction as { actionId: string; toolName: string; input: Record<string, unknown> };
    const result = await callTool(tools, 'execute_system_action', { actionId: action.actionId, toolName: action.toolName, input: action.input });
    return { executionResult: result };
  }

  async function inspectResult(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'inspectResult' });
    const result = (await callTool(tools, 'inspect_result', {
      actionId: state.currentActionId ?? randomUUID(),
      result: state.executionResult,
      intent: state.userIntent ?? '',
    })) as { complete: boolean; quality: string; summary: string; dataShape: unknown };
    return { taskComplete: result.complete, inspectionDataShape: result.dataShape };
  }

  async function decideNextStep(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'decideNextStep' });
    const decideModel = modelProvider.getChatModel(['decideNextStep']);
    const raw = await streamText(decideModel, [
      new SystemMessage(
        'The task is not yet complete. Decide the next step. ' +
        '"another_query" = run another data query, ' +
        '"another_system" = call an external system/API, ' +
        '"human_decision" = human input is required.' +
        '\n\nReply with a single JSON object only. No markdown fences.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\nCurrent result: ${JSON.stringify(state.executionResult)}\nPlan: "${state.currentPlan ?? 'none'}"`),
    ], config);
    return parseJsonFromRaw(raw, z.object({
      nextStepDecision: z.enum(['another_query', 'another_system', 'human_decision']),
    }));
  }

  async function callExternalSystem(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'callExternalSystem' });
    const result = await callTool(tools, 'execute_system_action', {
      actionId: randomUUID(),
      toolName: 'external_api',
      input: { endpoint: '/api/external', query: state.userIntent, previousResult: state.executionResult },
    });
    return { executionResult: result };
  }

  async function prepareUserDataForVisualization(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'prepareUserDataForVisualization' });
    const data = state.userProvidedData;
    const rows = Array.isArray(data) ? data : (data != null ? [data] : []);
    return {
      executionResult: { rows, success: true, actionId: randomUUID(), durationMs: 0, rowCount: rows.length },
      taskComplete: true,
      inspectionDataShape: { type: 'user_provided', rowCount: rows.length },
    };
  }

  async function populateVisualizationData(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'populateVisualizationData' });
    const result = (await callTool(tools, 'prepare_visualization_data', {
      result: state.executionResult,
      dataShape: state.inspectionDataShape,
    })) as { suitable: boolean; componentType: string; props: Record<string, unknown> };
    return { suitableForVisualization: result.suitable, visualizationComponentType: result.componentType, visualizationProps: result.props };
  }

  async function renderVisualization(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'renderVisualization' });
    const result = (await callTool(tools, 'render_visualization', {
      componentType: state.visualizationComponentType ?? 'text',
      props: state.visualizationProps ?? {},
    })) as { rendered: boolean; dataSpec: DataSpecPayload };
    return { visualizationPayload: result.dataSpec };
  }

  async function summarizeResult(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'summarizeResult' });
    const result = (await callTool(tools, 'summarize_result', {
      result: state.executionResult,
      intent: state.userIntent ?? '',
    })) as { summary: string };
    return { summary: result.summary };
  }

  async function humanReview(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'humanReview' });
    const reason = state.validationReason ?? 'High-risk action detected';
    const result = (await callTool(tools, 'human_review_gate', {
      reason,
      riskLevel: state.isUnsafe ? 'high' : 'medium',
      suggestedResponse: state.isUnsafe
        ? 'This request requires human review before I can proceed. Please contact support.'
        : reason,
    })) as { reviewNeeded: boolean; suggestedResponse: string };
    return { reviewNotes: result.suggestedResponse };
  }

  async function composeFinalResponse(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'composeFinalResponse' });
    const hasViz = Boolean(state.visualizationPayload);
    const execResult = state.executionResult as { rows?: Record<string, unknown>[]; columns?: string[]; rowCount?: number } | undefined;
    const hasRows = Array.isArray(execResult?.rows) && (execResult?.rows.length ?? 0) > 0;
    const rowCount = hasRows ? execResult!.rowCount : 0;
    const contextLines = [
      `User question: ${state.userIntent}`,
      state.summary ? `Data summary: ${state.summary}` : null,
      hasRows ? `Total records returned: ${rowCount}` : null,
      state.reviewNotes ? `Review notes: ${state.reviewNotes}` : null,
      hasViz ? 'A visualization has been prepared and will appear alongside this response.' : null,
    ]
      .filter(Boolean)
      .join('\n');

    const composeModel = modelProvider.getChatModel(['composeFinalResponse']);
    const finalResponse = await streamText(composeModel, [
      new SystemMessage(
        'You are an assistant for a text-to-SQL application. The user asks questions in plain language and you query a database on their behalf to find the answer. ' +
        'Write a concise, conversational response that directly answers the user\'s question based on what the data revealed. ' +
        'Focus on the outcome and insights from the data — what the results mean for the user. ' +
        'Do NOT mention SQL, queries, tables, columns, or technical database details. ' +
        'Do NOT explain how the query was built. Do NOT repeat the question back verbatim. ' +
        'Always end with a note that the full result table is shown below.',
      ),
      new HumanMessage(contextLines),
    ], config);
    logger.info({ responseLength: finalResponse.length, responsePreview: finalResponse.slice(0, 300) }, 'composeFinalResponse: LLM output');

    // Signal the outer stream loop to attach the table as a message-level data part.
    // Data is emitted AFTER the LLM call above so it is never in the model context.
    const execResultForTable = state.executionResult as { rows?: Record<string, unknown>[]; columns?: string[]; rowCount?: number } | undefined;
    if (Array.isArray(execResultForTable?.rows) && (execResultForTable?.rows.length ?? 0) > 0) {
      (config as any)?.writer?.({
        type: 'sql:final-table-result',
        columns: execResultForTable!.columns ?? [],
        rows: execResultForTable!.rows!,
        rowCount: execResultForTable!.rowCount ?? execResultForTable!.rows!.length,
      });
    }

    return { finalResponse };
  }

  async function streamFinalResponse(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    (config as any)?.writer?.({ type: 'node:start', node: 'streamFinalResponse' });
    logger.info(
      { responseLength: state.finalResponse?.length ?? 0, response: state.finalResponse, strategy: state.strategy, enoughContext: state.enoughContext },
      'Agent final response',
    );
    return { finalResponse: state.finalResponse };
  }

  return {
    analyzeUserIntent, strategyDecision, retrieveContext, answerFromLightRAG,
    planNextStep, disambiguateAskUser, generateSqlOrToolCall, validateSqlAction,
    executeSqlCallSystem, inspectResult, decideNextStep, callExternalSystem,
    prepareUserDataForVisualization, populateVisualizationData, renderVisualization,
    summarizeResult, humanReview, composeFinalResponse, streamFinalResponse,
  };
}

// ─── Conditional Edge Functions ───────────────────────────────────────────────

function routeAfterStrategy(state: AgentState): string {
  return state.strategy === 'data_passthrough' ? 'prepareUserDataForVisualization' : 'retrieveContext';
}

function routeAfterContext(state: AgentState): string {
  if (state.strategy === 'direct' || state.strategy === 'data_crosscheck') return 'answerFromLightRAG';
  if (state.strategy === 'sql' || state.strategy === 'system_tool' || state.strategy === 'hybrid') {
    return 'planNextStep';
  }
  return state.enoughContext ? 'answerFromLightRAG' : 'planNextStep';
}

function routeAfterPlan(state: AgentState): string {
  return state.needsUserInput ? 'disambiguateAskUser' : 'generateSqlOrToolCall';
}

function routeAfterValidation(state: AgentState): string {
  if (state.validationStatus === 'valid') return 'executeSqlCallSystem';
  if (state.validationStatus === 'invalid_recoverable' && (state.retryCount ?? 0) < 2) return 'generateSqlOrToolCall';
  return 'humanReview';
}

function routeAfterInspect(state: AgentState): string {
  if (state.isUnsafe) return 'humanReview';
  if (!state.taskComplete) return 'decideNextStep';
  return 'populateVisualizationData';
}

function routeAfterDecideNextStep(state: AgentState): string {
  if (state.nextStepDecision === 'human_decision') return 'disambiguateAskUser';
  if (state.nextStepDecision === 'another_system') return 'callExternalSystem';
  return 'generateSqlOrToolCall';
}

function routeAfterVisualizationCheck(state: AgentState): string {
  return state.suitableForVisualization ? 'renderVisualization' : 'summarizeResult';
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

function buildGraph(tools: ToolMap, logger: PinoLogger, modelProvider: ModelProvider): CompiledStateGraph<AgentState, Partial<AgentState>> {
  const nodes = buildNodes(tools, logger, modelProvider);

  const workflow = new StateGraph(AgentStateSchema)
    .addNode('analyzeUserIntent',         nodes.analyzeUserIntent)
    .addNode('strategyDecision',          nodes.strategyDecision)
    .addNode('retrieveContext',           nodes.retrieveContext)
    .addNode('planNextStep',              nodes.planNextStep)
    .addNode('answerFromLightRAG',        nodes.answerFromLightRAG)
    .addNode('disambiguateAskUser',       nodes.disambiguateAskUser)
    .addNode('generateSqlOrToolCall',     nodes.generateSqlOrToolCall)
    .addNode('validateSqlAction',         nodes.validateSqlAction)
    .addNode('executeSqlCallSystem',      nodes.executeSqlCallSystem)
    .addNode('inspectResult',             nodes.inspectResult)
    .addNode('decideNextStep',            nodes.decideNextStep)
    .addNode('callExternalSystem',        nodes.callExternalSystem)
    .addNode('prepareUserDataForVisualization', nodes.prepareUserDataForVisualization)
    .addNode('populateVisualizationData', nodes.populateVisualizationData)
    .addNode('renderVisualization',       nodes.renderVisualization)
    .addNode('summarizeResult',           nodes.summarizeResult)
    .addNode('humanReview',               nodes.humanReview)
    .addNode('composeFinalResponse',      nodes.composeFinalResponse)
    .addNode('streamFinalResponse',       nodes.streamFinalResponse)

    .addEdge(START,                            'analyzeUserIntent')
    .addEdge('analyzeUserIntent',              'strategyDecision')
    .addEdge('prepareUserDataForVisualization','populateVisualizationData')
    .addEdge('generateSqlOrToolCall',     'validateSqlAction')
    .addEdge('executeSqlCallSystem',      'inspectResult')
    .addEdge('callExternalSystem',        'inspectResult')
    .addEdge('renderVisualization',       'composeFinalResponse')
    .addEdge('summarizeResult',           'composeFinalResponse')
    .addEdge('humanReview',               'composeFinalResponse')
    .addEdge('disambiguateAskUser',       'composeFinalResponse')
    .addEdge('answerFromLightRAG',        'streamFinalResponse')
    .addEdge('composeFinalResponse',      'streamFinalResponse')
    .addEdge('streamFinalResponse',       END)

    .addConditionalEdges('strategyDecision', routeAfterStrategy, {
      retrieveContext:               'retrieveContext',
      prepareUserDataForVisualization: 'prepareUserDataForVisualization',
    })
    .addConditionalEdges('retrieveContext', routeAfterContext, {
      answerFromLightRAG: 'answerFromLightRAG',
      planNextStep:       'planNextStep',
    })
    .addConditionalEdges('planNextStep', routeAfterPlan, {
      disambiguateAskUser:   'disambiguateAskUser',
      generateSqlOrToolCall: 'generateSqlOrToolCall',
    })
    .addConditionalEdges('validateSqlAction', routeAfterValidation, {
      executeSqlCallSystem:  'executeSqlCallSystem',
      generateSqlOrToolCall: 'generateSqlOrToolCall',
      humanReview:           'humanReview',
    })
    .addConditionalEdges('inspectResult', routeAfterInspect, {
      humanReview:              'humanReview',
      decideNextStep:           'decideNextStep',
      populateVisualizationData:'populateVisualizationData',
    })
    .addConditionalEdges('decideNextStep', routeAfterDecideNextStep, {
      disambiguateAskUser:   'disambiguateAskUser',
      callExternalSystem:    'callExternalSystem',
      generateSqlOrToolCall: 'generateSqlOrToolCall',
    })
    .addConditionalEdges('populateVisualizationData', routeAfterVisualizationCheck, {
      renderVisualization: 'renderVisualization',
      summarizeResult:     'summarizeResult',
    });

  const memory = new MemorySaver();
  return workflow.compile({ checkpointer: memory }) as any;
}

// ─── Frontend helpers (unchanged) ─────────────────────────────────────────────

const STREAMING_NODES = new Set([
  'answerFromLightRAG',
  'disambiguateAskUser',
  'composeFinalResponse',
]);

// Nodes whose LLM tokens stream into their tool group but NOT into the main text stream.
const TOOL_STREAMING_NODES = new Set([
  'analyzeUserIntent',
  'strategyDecision',
  'planNextStep',
  'decideNextStep',
]);

function resolveToolName(nodeName: string, state: AgentState): string | undefined {
  switch (nodeName) {
    case 'analyzeUserIntent':         return 'analyze_user_intent';
    case 'strategyDecision':          return 'strategy_decision';
    case 'retrieveContext':           return 'retrieve_context';
    case 'planNextStep':              return 'plan_next_step';
    case 'disambiguateAskUser':       return 'clarification_request';
    case 'generateSqlOrToolCall':     return state.strategy === 'sql' ? 'generate_sql' : 'generate_action';
    case 'validateSqlAction':         return state.generatedSql ? 'validate_sql' : 'validate_action';
    case 'executeSqlCallSystem':      return state.generatedSql ? 'execute_sql' : 'execute_system_action';
    case 'callExternalSystem':        return 'execute_system_action';
    case 'inspectResult':             return 'inspect_result';
    case 'decideNextStep':            return 'decide_next_step';
    case 'populateVisualizationData': return 'prepare_visualization_data';
    case 'renderVisualization':       return 'render_visualization';
    case 'summarizeResult':           return 'summarize_result';
    case 'humanReview':               return 'human_review_gate';
    case 'composeFinalResponse':      return 'compose_final_response';
    default:                          return undefined;
  }
}

function resolveStartingMessage(nodeName: string, state: AgentState): string {
  const intent = state.userIntent ? `"${state.userIntent}"` : 'the request';
  switch (nodeName) {
    case 'analyzeUserIntent':         return `Reading message and extracting intent…`;
    case 'strategyDecision':          return `Selecting execution strategy for ${intent}…`;
    case 'retrieveContext':           return `Searching knowledge base for ${intent}…`;
    case 'planNextStep':              return `Planning next action for ${intent} via ${state.strategy ?? 'unknown'} strategy…`;
    case 'disambiguateAskUser':       return `Generating clarification question for ${intent}…`;
    case 'generateSqlOrToolCall':     return state.strategy === 'sql' ? `Generating SQL query for ${intent}…` : `Generating tool call for ${intent}…`;
    case 'validateSqlAction':         return state.generatedSql ? `Validating SQL query safety and correctness…` : `Validating action parameters…`;
    case 'executeSqlCallSystem':      return state.generatedSql ? `Executing SQL against the database…` : `Executing system action…`;
    case 'callExternalSystem':        return `Calling external system for ${intent}…`;
    case 'inspectResult':             return `Inspecting execution result for completeness…`;
    case 'decideNextStep':            return `Evaluating result and deciding next step…`;
    case 'populateVisualizationData': return `Preparing data for visualization…`;
    case 'renderVisualization':       return `Rendering ${state.visualizationComponentType ?? 'visualization'} component…`;
    case 'summarizeResult':           return `Summarizing result for ${intent}…`;
    case 'humanReview':               return `Flagging for human review — risk level: ${state.isUnsafe ? 'high' : 'medium'}…`;
    case 'composeFinalResponse':      return `Composing final response for ${intent}…`;
    default:                          return `Processing…`;
  }
}

function extractNodeArgs(nodeName: string, state: AgentState): Record<string, unknown> {
  const action = state.generatedAction as Record<string, unknown> | undefined;
  switch (nodeName) {
    case 'analyzeUserIntent':         return { query: state.messages.at(-1)?.content ?? '' };
    case 'strategyDecision':          return { intent: state.userIntent };
    case 'retrieveContext':           return { query: state.userIntent ?? state.messages.at(-1)?.content ?? '', mode: 'mix', strategy: state.strategy };
    case 'planNextStep':              return { intent: state.userIntent, strategy: state.strategy };
    case 'answerFromLightRAG':        return { intent: state.userIntent, documentCount: state.retrievedContext?.documents?.length ?? 0, enoughContext: state.enoughContext };
    case 'disambiguateAskUser':       return { intent: state.userIntent, plan: state.currentPlan };
    case 'generateSqlOrToolCall':     return state.strategy === 'sql'
      ? { intent: state.userIntent, dialect: state.sqlDialect ?? 'postgres', strategy: 'sql', retry: state.retryCount }
      : { intent: state.userIntent, strategy: state.strategy, system: state.strategy === 'system_tool' ? 'calculator' : 'generic_search' };
    case 'validateSqlAction':         return state.generatedSql ? { sql: state.generatedSql, dialect: state.sqlDialect } : { toolName: action?.toolName, input: action?.input };
    case 'executeSqlCallSystem':      return state.generatedSql ? { sql: state.generatedSql } : { toolName: action?.toolName, input: action?.input };
    case 'callExternalSystem':        return { intent: state.userIntent, hasPreviousResult: state.executionResult !== undefined };
    case 'inspectResult':             return { intent: state.userIntent, hasResult: state.executionResult !== undefined };
    case 'decideNextStep':            return { intent: state.userIntent, hasResult: state.executionResult !== undefined };
    case 'populateVisualizationData': return { hasResult: state.executionResult !== undefined, dataShape: state.inspectionDataShape };
    case 'renderVisualization':       return { componentType: state.visualizationComponentType, props: state.visualizationProps };
    case 'summarizeResult':           return { intent: state.userIntent, hasResult: state.executionResult !== undefined };
    case 'humanReview':               return { reason: state.validationReason, riskLevel: state.isUnsafe ? 'high' : 'medium', sql: state.generatedSql };
    case 'composeFinalResponse':      return { intent: state.userIntent, hasSummary: Boolean(state.summary), hasVisualization: Boolean(state.visualizationPayload), reviewNotes: state.reviewNotes };
    default:                          return {};
  }
}

function summarizeNodeOutput(nodeName: string, output: Partial<AgentState>): unknown {
  const genAction = output.generatedAction as Record<string, unknown> | undefined;
  const vizPayload = output.visualizationPayload as Record<string, unknown> | undefined;
  switch (nodeName) {
    case 'analyzeUserIntent':         return { userIntent: output.userIntent };
    case 'strategyDecision':          return { strategy: output.strategy };
    case 'planNextStep':              return { currentPlan: output.currentPlan, needsUserInput: output.needsUserInput };
    case 'decideNextStep':            return { nextStepDecision: output.nextStepDecision };
    case 'retrieveContext': {
      const docs = output.retrievedContext?.documents ?? [];
      const items = docs.map((d) => ({ title: d.title ?? d.id ?? 'Unknown', source: d.source, score: typeof d.score === 'number' ? Math.round(d.score * 100) / 100 : undefined }));
      const sources = items.map((it) => it.source).filter((s): s is string => Boolean(s)).slice(0, 8);
      return { sufficient: output.retrievedContext?.sufficient, documentCount: docs.length, items, sources, summary: output.retrievedContext?.contextSummary };
    }
    case 'answerFromLightRAG':
    case 'disambiguateAskUser':       return { responseLength: output.finalResponse?.length ?? 0 };
    case 'generateSqlOrToolCall':     return output.generatedSql
      ? { type: 'sql', sql: output.generatedSql, dialect: output.sqlDialect }
      : { type: 'action', toolName: genAction?.toolName, input: genAction?.input };
    case 'validateSqlAction':         return { status: output.validationStatus, reason: output.validationReason, isUnsafe: output.isUnsafe };
    case 'executeSqlCallSystem':
    case 'callExternalSystem':        return output.executionResult;
    case 'inspectResult':             return { complete: output.taskComplete, dataShape: output.inspectionDataShape };
    case 'populateVisualizationData': return { suitable: output.suitableForVisualization, componentType: output.visualizationComponentType };
    case 'renderVisualization':       return { rendered: vizPayload !== undefined, componentType: vizPayload?.componentType };
    case 'summarizeResult':           return { summary: output.summary };
    case 'humanReview':               return { reviewNotes: output.reviewNotes };
    case 'composeFinalResponse':      return { responseLength: output.finalResponse?.length ?? 0 };
    default:                          return output;
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ChatService implements OnModuleInit {
  private app!: CompiledStateGraph<AgentState, Partial<AgentState>, any>;

  constructor(
    @InjectPinoLogger(ChatService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  onModuleInit(): void {
    const tools = this.toolRegistry.getAll();
    this.app = buildGraph(tools, this.logger, this.modelProvider);
    this.logger.info('Agent graph compiled and ready');
  }

  stream(dto: ChatRequestDto, res: Response): void {
    const messages = dto.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const initialState: AgentState = { messages, retryCount: 0 };
    const threadId = randomUUID();
    const config = { configurable: { thread_id: threadId }, recursionLimit: 50 };

    this.logger.info({ threadId, messageCount: messages.length }, 'Chat stream started');

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Tracks open text parts and tool groups keyed by node name
        const openTextParts = new Map<string, string>();    // nodeName → text-part id
        const openToolGroups = new Map<string, string>();   // nodeName → toolCallId
        const resolvedToolNames = new Map<string, string>(); // nodeName → tool name

        // Accumulates the live state snapshot by merging every updates delta.
        // Lets resolveToolName / resolveStartingMessage / extractNodeArgs read
        // the full graph state even while a node is still executing.
        let currentState: AgentState = { ...initialState };

        const closeTextPart = (nodeName: string) => {
          const id = openTextParts.get(nodeName);
          if (id) {
            writer.write({ type: 'text-end', id });
            openTextParts.delete(nodeName);
          }
        };

        const closeToolGroup = (nodeName: string, stateDelta: Partial<AgentState>) => {
          const toolCallId = openToolGroups.get(nodeName);
          if (toolCallId) {
            openToolGroups.delete(nodeName);
            resolvedToolNames.delete(nodeName);
            const summary = summarizeNodeOutput(nodeName, stateDelta);
            writer.write({ type: 'tool-output-available', toolCallId, output: summary });
          }
        };

        const openToolGroup = (nodeName: string) => {
          if (openToolGroups.has(nodeName)) return;
          const toolName = resolveToolName(nodeName, currentState);
          if (!toolName) return;
          const toolCallId = randomUUID();
          openToolGroups.set(nodeName, toolCallId);
          resolvedToolNames.set(nodeName, toolName);
          const input = extractNodeArgs(nodeName, currentState);
          writer.write({ type: 'tool-input-available', toolCallId, toolName, input });
          const startMsg = resolveStartingMessage(nodeName, currentState);
          (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: startMsg });
        };

        try {
          // ── graph.stream with all three stream modes ──────────────────────
          const graphStream = await this.app.stream(initialState, {
            ...config,
            streamMode: ['updates', 'messages', 'custom'] as const,
          });

          for await (const streamChunk of graphStream) {
            // When multiple streamModes are active every chunk is [mode, data]
            const [mode, data] = streamChunk as [string, unknown];

            // ── custom ─────────────────────────────────────────────────────
            // Emitted from inside nodes via config.writer.
            // node:start  → open the tool group for this node
            // node:progress → append a progress line to the tool group delta
            if (mode === 'custom') {
              // Final SQL table — written as a message data part so it appears
              // after the response text, outside the tool timeline.
              if ((data as any).type === 'sql:final-table-result') {
                const d = data as { type: string; columns: string[]; rows: Record<string, unknown>[]; rowCount: number };
                writer.write({
                  type: 'data-spec',
                  data: { componentType: 'sql-result-table', props: { columns: d.columns, rows: d.rows, rowCount: d.rowCount } },
                });
                continue;
              }

              const event = data as NodeCustomEvent;
              terminalLog('custom', event.node, event);
              this.logger.debug({ streamMode: 'custom', node: event.node, event }, 'stream event');

              if (event.type === 'node:start') {
                openToolGroup(event.node);
              } else if (event.type === 'node:progress') {
                const toolCallId = openToolGroups.get(event.node);
                if (toolCallId) {
                  if (event.step === 'token') {
                    (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: event.data as string });
                  } else if (event.step === 'sql-query') {
                    const { sql, dialect } = event.data as { sql: string; dialect: string };
                    (writer as any).write({ type: 'sql-generated', toolCallId, sql, dialect });
                  } else if (event.step === 'sql-table-start') {
                    const { columns } = event.data as { columns: string[] };
                    (writer as any).write({ type: 'sql-table-start', toolCallId, columns });
                  } else if (event.step === 'sql-table-row') {
                    const { row } = event.data as { row: Record<string, unknown> };
                    (writer as any).write({ type: 'sql-table-row', toolCallId, row });
                  } else if (event.step === 'sql-table-end') {
                    const { rowCount } = event.data as { rowCount: number };
                    (writer as any).write({ type: 'sql-table-end', toolCallId, rowCount });
                  } else {
                    const progressLine = `\n[${event.step}] ${JSON.stringify(event.data ?? {})}`;
                    (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: progressLine });
                  }
                }
              }
              continue;
            }

            // ── messages ──────────────────────────────────────────────────
            // One chunk per LLM token. Metadata includes langgraph_node so we
            // know which node is currently streaming.
            if (mode === 'messages') {
              const [chunk, metadata] = data as [
                { content: unknown },
                { langgraph_node?: string; langgraph_step?: number; ls_model_name?: string },
              ];
              const nodeName = metadata?.langgraph_node;

              // Extract token text from the chunk
              let token = '';
              const content = chunk.content;
              if (typeof content === 'string') {
                token = content;
              } else if (Array.isArray(content)) {
                for (const block of content as Array<{ type?: string; text?: string }>) {
                  if (block.type === 'text' && block.text) token += block.text;
                }
              }

              terminalLog('messages', nodeName, {
                token,
                step: metadata?.langgraph_step,
                model: metadata?.ls_model_name,
              });
              this.logger.debug(
                { streamMode: 'messages', node: nodeName, tokenLength: token.length, step: metadata?.langgraph_step },
                'stream event',
              );

              if (!token || !nodeName) continue;

              // For streaming nodes, open the tool group on the first token
              // if the node:start custom event hasn't already done so.
              if (STREAMING_NODES.has(nodeName) || TOOL_STREAMING_NODES.has(nodeName)) {
                openToolGroup(nodeName);
              }

              // Route token to the main text stream for terminal streaming nodes
              if (STREAMING_NODES.has(nodeName)) {
                if (!openTextParts.has(nodeName)) {
                  const id = randomUUID();
                  openTextParts.set(nodeName, id);
                  writer.write({ type: 'text-start', id });
                }
                const id = openTextParts.get(nodeName)!;
                writer.write({ type: 'text-delta', id, delta: token });
              }

              // Pipe token into the tool group delta for streaming nodes and tool-only streaming nodes.
              // (LLM-JSON nodes produce internal JSON tokens — not user-visible)
              if (STREAMING_NODES.has(nodeName) || TOOL_STREAMING_NODES.has(nodeName)) {
                const toolCallId = openToolGroups.get(nodeName);
                if (toolCallId) {
                  (writer as any).write({ type: 'tool-output-delta', toolCallId, delta: token });
                }
              }
              continue;
            }

            // ── updates ───────────────────────────────────────────────────
            // Emitted once per node after it completes. data = { nodeName: stateDelta }.
            if (mode === 'updates') {
              const updateMap = data as Record<string, Partial<AgentState>>;

              for (const [nodeName, stateDelta] of Object.entries(updateMap)) {
                terminalLog('updates', nodeName, stateDelta);
                this.logger.debug({ streamMode: 'updates', node: nodeName, delta: stateDelta }, 'stream event');

                // Merge delta into our running state snapshot
                currentState = { ...currentState, ...stateDelta };

                // Close text part and tool group now that the node has finished
                closeTextPart(nodeName);
                closeToolGroup(nodeName, stateDelta);

                // Emit visualization payload when the render node completes
                if (nodeName === 'renderVisualization') {
                  const ds = stateDelta.visualizationPayload as DataSpecPayload | undefined;
                  if (ds?.componentType) {
                    writer.write({ type: 'data-spec', data: { componentType: ds.componentType, props: ds.props } });
                  }
                }
              }
            }
          }

          // Flush any parts that were still open when the stream ended
          for (const [, id] of openTextParts) writer.write({ type: 'text-end', id });
          openTextParts.clear();

          this.logger.info({ threadId }, 'Chat stream completed');
        } catch (err) {
          for (const [, id] of openTextParts) writer.write({ type: 'text-end', id });
          openTextParts.clear();
          const message = err instanceof Error ? err.message : 'An unexpected error occurred';
          this.logger.error({ threadId, err }, 'Chat stream error');
          writer.write({ type: 'error', errorText: message });
        }
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }
}
