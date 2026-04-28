import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Response } from 'express';
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import type { CompiledStateGraph } from '@langchain/langgraph';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import * as z from 'zod';
import { randomUUID } from 'node:crypto';
import { ModelProvider } from './providers/model.provider';
import { ToolRegistry } from './tools/tool-registry';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { DataSpecPayload } from './dto/sse-event.dto';

// ─── State Schema ─────────────────────────────────────────────────────────────

const AgentStateSchema = z.object({
  // Conversation input
  messages: z.array(
    z.object({ role: z.enum(['user', 'assistant']), content: z.string() }),
  ),

  // Intent & strategy (Analyze User Intent + Strategy Decision nodes)
  userIntent: z.string().optional(),
  strategy: z
    .enum(['direct', 'sql', 'system_tool', 'hybrid', 'unknown'])
    .optional(),

  // Retrieved context (Retrieve Context from LightRAG node)
  retrievedContext: z
    .object({
      documents: z.array(z.any()),
      query: z.string(),
      sufficient: z.boolean(),
      contextSummary: z.string().optional(),
    })
    .optional(),
  enoughContext: z.boolean().optional(),

  // Planning (Plan Next Step node)
  currentPlan: z.string().optional(),
  needsUserInput: z.boolean().optional(),

  // SQL / Action generation (Generate SQL or Tool Call node)
  currentActionId: z.string().optional(),
  generatedSql: z.string().optional(),
  sqlDialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional(),
  generatedAction: z.any().optional(),
  retryCount: z.number().default(0),

  // Validation (Validate SQL / Action node)
  validationStatus: z
    .enum(['valid', 'invalid_recoverable', 'invalid_blocking'])
    .optional(),
  validationReason: z.string().optional(),
  isUnsafe: z.boolean().optional(),

  // Execution (Execute SQL / Call System node)
  executionResult: z.any().optional(),

  // Inspection (Inspect Result node)
  taskComplete: z.boolean().optional(),
  inspectionDataShape: z.any().optional(),

  // Next-step routing (Decide Next Step node)
  nextStepDecision: z
    .enum(['another_query', 'another_system', 'human_decision'])
    .optional(),

  // Visualization (Populate Data + Render nodes)
  suitableForVisualization: z.boolean().optional(),
  visualizationComponentType: z.string().optional(),
  visualizationProps: z.any().optional(),
  visualizationPayload: z.any().optional(),

  // Summarization & review
  summary: z.string().optional(),
  reviewNotes: z.string().optional(),

  // Final output (Compose Final Response + Stream Final Response nodes)
  finalResponse: z.string().optional(),
});

type AgentState = z.infer<typeof AgentStateSchema>;
type ToolMap = ReturnType<ToolRegistry['getAll']>;
type LlmClient = ReturnType<ModelProvider['getChatModel']>;

const IntentAnalysisSchema = z
  .object({
    userIntent: z.string().trim().optional(),
    intent: z.string().trim().optional(),
    coreIntent: z.string().trim().optional(),
    summary: z.string().trim().optional(),
  })
  .passthrough()
  .transform((value) => ({
    userIntent: [value.userIntent, value.intent, value.coreIntent, value.summary].find(
      (intent): intent is string => Boolean(intent),
    ),
  }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(tools: ToolMap, name: string, input: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools[name] as any).execute(input, { toolCallId: randomUUID(), messages: [] });
}

async function llmJson<T>(
  llm: LlmClient,
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await llm.invoke([
    new SystemMessage(`${system}\n\nReply with a single JSON object only. No markdown fences.`),
    new HumanMessage(user),
  ]);
  const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM did not return JSON. Got: ${raw.slice(0, 200)}`);
  return schema.parse(JSON.parse(match[0]));
}

// ─── Node Factories ────────────────────────────────────────────────────────────

function buildNodes(llm: LlmClient, tools: ToolMap, logger: PinoLogger) {

  // ── Analyze User Intent ──────────────────────────────────────────────────
  async function analyzeUserIntent(state: AgentState): Promise<Partial<AgentState>> {
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const query = lastUser?.content ?? '';
    try {
      const result = await llmJson(
        llm,
        'You are an intent-analysis assistant. Extract the user\'s core intent from their message. Use the JSON key "userIntent".',
        `User message: "${query}"`,
        IntentAnalysisSchema,
      );
      return { userIntent: result.userIntent ?? query };
    } catch {
      return { userIntent: query };
    }
  }

  // ── Strategy Decision ────────────────────────────────────────────────────
  async function strategyDecision(state: AgentState): Promise<Partial<AgentState>> {
    const VALID_STRATEGIES = ['direct', 'sql', 'system_tool', 'hybrid', 'unknown'] as const;
    return llmJson(
      llm,
      'Select the best execution strategy for the given intent. ' +
        '"sql" = needs database query, "system_tool" = needs calculator/search/API, ' +
        '"direct" = can be answered from knowledge, "hybrid" = mixed, "unknown" = unclear. ' +
        'Use exactly one of these values as the "strategy" key: direct, sql, system_tool, hybrid, unknown.',
      `Intent: "${state.userIntent}"`,
      z.object({
        strategy: z
          .string()
          .transform((val): typeof VALID_STRATEGIES[number] => {
            const norm = val.toLowerCase().trim() as typeof VALID_STRATEGIES[number];
            return VALID_STRATEGIES.includes(norm) ? norm : 'unknown';
          }),
      }),
    );
  }

  // ── Retrieve Context from LightRAG ───────────────────────────────────────
  async function retrieveContext(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'retrieve_context', {
      query: state.userIntent ?? state.messages.at(-1)?.content ?? '',
      mode: 'hybrid',
      maxDocuments: 5,
    })) as { documents: unknown[]; query: string; sufficient: boolean; contextSummary?: string };

    return {
      retrievedContext: result,
      enoughContext: result.sufficient,
    };
  }

  // ── Answer from LightRAG  (terminal — direct-context path) ───────────────
  async function answerFromLightRAG(state: AgentState): Promise<Partial<AgentState>> {
    const documents = state.retrievedContext?.documents ?? [];
    const contextText = documents
      .map((d) => (d as Record<string, unknown>).content)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .join('\n\n');

    const hasContext = contextText.length > 0;

    logger.info(
      {
        documentCount: documents.length,
        hasContext,
        contextLength: contextText.length,
        contextPreview: contextText.slice(0, 300),
        enoughContext: state.enoughContext,
        strategy: state.strategy,
      },
      'answerFromLightRAG: context state',
    );

    const systemPrompt = hasContext
      ? 'You are a knowledgeable assistant. Answer the question using the provided context as your primary source. ' +
        'You may supplement with your general knowledge when the context is incomplete, but clearly prioritise information from the context. ' +
        'Be thorough and informative — do not ask the user for more details.'
      : 'You are a knowledgeable assistant. Answer the question using your general knowledge. ' +
        'Be thorough and informative — do not ask the user for more details.';

    const humanMessage = hasContext
      ? `Question: ${state.userIntent}\n\nContext from knowledge base:\n${contextText}`
      : `Question: ${state.userIntent}`;

    let finalResponse = '';
    for await (const chunk of await llm.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(humanMessage),
    ])) {
      finalResponse += typeof chunk.content === 'string' ? chunk.content : '';
    }

    logger.info({ responseLength: finalResponse.length, responsePreview: finalResponse.slice(0, 300) }, 'answerFromLightRAG: LLM output');
    return { finalResponse };
  }

  // ── Plan Next Step ───────────────────────────────────────────────────────
  async function planNextStep(state: AgentState): Promise<Partial<AgentState>> {
    return llmJson(
      llm,
      'Plan the next step for fulfilling the user intent. ' +
        'Set needsUserInput=false for general knowledge questions, broad topic inquiries, or any query where a database or external tool can be attempted. ' +
        'Set needsUserInput=true ONLY when a specific required value (e.g. account ID, date range, or secret credential) is completely unknown and cannot be inferred or assumed. ' +
        'When in doubt, prefer needsUserInput=false and attempt to answer or query.',
      `Intent: "${state.userIntent}"\nStrategy: "${state.strategy}"\nContext available: "${state.retrievedContext?.contextSummary ?? 'none'}"`,
      z.object({
        currentPlan: z.string().describe('One-sentence plan for the next action'),
        needsUserInput: z
          .boolean()
          .describe('true ONLY if a specific required value is completely missing and cannot be assumed'),
      }),
    );
  }

  // ── Disambiguate / Ask User  (terminal — clarification path) ────────────
  async function disambiguateAskUser(state: AgentState): Promise<Partial<AgentState>> {
    let finalResponse = '';
    for await (const chunk of await llm.stream([
      new SystemMessage(
        'Generate a concise, specific clarification question for the user. ' +
          'Do not answer the question — only ask for the missing information.',
      ),
      new HumanMessage(
        `Intent: "${state.userIntent}"\nPlan: "${state.currentPlan ?? 'none'}"`,
      ),
    ])) {
      finalResponse += typeof chunk.content === 'string' ? chunk.content : '';
    }
    return { finalResponse };
  }

  // ── Generate SQL or Tool Call ────────────────────────────────────────────
  async function generateSqlOrToolCall(state: AgentState): Promise<Partial<AgentState>> {
    // Increment retry counter when re-entering after a failed validation
    const retryCount =
      (state.retryCount ?? 0) + (state.validationStatus != null ? 1 : 0);

    if (state.strategy === 'sql') {
      const result = (await callTool(tools, 'generate_sql', {
        intent: state.userIntent ?? '',
        dialect: 'postgres',
        schemaHint: state.retrievedContext?.contextSummary,
        rationale: state.currentPlan,
      })) as { actionId: string; sql: string; dialect: string };

      return {
        currentActionId: result.actionId,
        generatedSql: result.sql,
        sqlDialect: result.dialect as AgentState['sqlDialect'],
        generatedAction: undefined,
        retryCount,
      };
    }

    const systemMap: Record<string, string> = {
      system_tool: 'calculator',
      hybrid: 'generic_search',
      direct: 'generic_search',
      unknown: 'generic_search',
    };
    const result = (await callTool(tools, 'generate_action', {
      intent: state.userIntent ?? '',
      system: systemMap[state.strategy ?? 'unknown'] ?? 'generic_search',
      params: { query: state.userIntent },
      rationale: state.currentPlan,
    })) as { actionId: string; toolName: string; input: Record<string, unknown> };

    return {
      currentActionId: result.actionId,
      generatedAction: result,
      generatedSql: undefined,
      retryCount,
    };
  }

  // ── Validate SQL / Action ────────────────────────────────────────────────
  async function validateSqlAction(state: AgentState): Promise<Partial<AgentState>> {
    if (state.generatedSql) {
      const result = (await callTool(tools, 'validate_sql', {
        actionId: state.currentActionId ?? randomUUID(),
        sql: state.generatedSql,
        dialect: state.sqlDialect ?? 'postgres',
      })) as { status: string; reason: string; riskLevel: string };

      return {
        validationStatus: result.status as AgentState['validationStatus'],
        validationReason: result.reason,
        isUnsafe: result.riskLevel === 'high',
      };
    }

    const action = state.generatedAction as {
      actionId: string;
      toolName: string;
      input: Record<string, unknown>;
    };
    const result = (await callTool(tools, 'validate_action', {
      actionId: action.actionId,
      toolName: action.toolName,
      input: action.input,
    })) as { status: string; reason: string };

    return {
      validationStatus: result.status as AgentState['validationStatus'],
      validationReason: result.reason,
    };
  }

  // ── Execute SQL / Call System ────────────────────────────────────────────
  async function executeSqlCallSystem(state: AgentState): Promise<Partial<AgentState>> {
    if (state.generatedSql) {
      const result = await callTool(tools, 'execute_sql', {
        actionId: state.currentActionId ?? randomUUID(),
        sql: state.generatedSql,
      });
      return { executionResult: result };
    }

    const action = state.generatedAction as {
      actionId: string;
      toolName: string;
      input: Record<string, unknown>;
    };
    const result = await callTool(tools, 'execute_system_action', {
      actionId: action.actionId,
      toolName: action.toolName,
      input: action.input,
    });
    return { executionResult: result };
  }

  // ── Inspect Result ───────────────────────────────────────────────────────
  async function inspectResult(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'inspect_result', {
      actionId: state.currentActionId ?? randomUUID(),
      result: state.executionResult,
      intent: state.userIntent ?? '',
    })) as { complete: boolean; quality: string; summary: string; dataShape: unknown };

    return {
      taskComplete: result.complete,
      inspectionDataShape: result.dataShape,
    };
  }

  // ── Decide Next Step ─────────────────────────────────────────────────────
  async function decideNextStep(state: AgentState): Promise<Partial<AgentState>> {
    return llmJson(
      llm,
      'The task is not yet complete. Decide the next step. ' +
        '"another_query" = run another data query, ' +
        '"another_system" = call an external system/API, ' +
        '"human_decision" = human input is required.',
      `Intent: "${state.userIntent}"\nCurrent result: ${JSON.stringify(state.executionResult)}\nPlan: "${state.currentPlan ?? 'none'}"`,
      z.object({
        nextStepDecision: z.enum(['another_query', 'another_system', 'human_decision']),
      }),
    );
  }

  // ── Call External System ─────────────────────────────────────────────────
  async function callExternalSystem(state: AgentState): Promise<Partial<AgentState>> {
    const result = await callTool(tools, 'execute_system_action', {
      actionId: randomUUID(),
      toolName: 'external_api',
      input: {
        endpoint: '/api/external',
        query: state.userIntent,
        previousResult: state.executionResult,
      },
    });
    return { executionResult: result };
  }

  // ── Populate Data for Visualization ─────────────────────────────────────
  async function populateVisualizationData(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'prepare_visualization_data', {
      result: state.executionResult,
      dataShape: state.inspectionDataShape,
    })) as { suitable: boolean; componentType: string; props: Record<string, unknown> };

    return {
      suitableForVisualization: result.suitable,
      visualizationComponentType: result.componentType,
      visualizationProps: result.props,
    };
  }

  // ── Render via json-render.dev ───────────────────────────────────────────
  async function renderVisualization(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'render_visualization', {
      componentType: state.visualizationComponentType ?? 'text',
      props: state.visualizationProps ?? {},
    })) as { rendered: boolean; dataSpec: DataSpecPayload };

    return { visualizationPayload: result.dataSpec };
  }

  // ── Summarize Result ─────────────────────────────────────────────────────
  async function summarizeResult(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'summarize_result', {
      result: state.executionResult,
      intent: state.userIntent ?? '',
    })) as { summary: string };

    return { summary: result.summary };
  }

  // ── Human Review  (terminal — unsafe/risky path) ─────────────────────────
  async function humanReview(state: AgentState): Promise<Partial<AgentState>> {
    const result = (await callTool(tools, 'human_review_gate', {
      reason: state.validationReason ?? 'High-risk action detected',
      riskLevel: 'high',
      suggestedResponse:
        'This request requires human review before I can proceed. Please contact support.',
    })) as { reviewNeeded: boolean; suggestedResponse: string };

    return { reviewNotes: result.suggestedResponse };
  }

  // ── Compose Final Response ───────────────────────────────────────────────
  async function composeFinalResponse(state: AgentState): Promise<Partial<AgentState>> {
    const hasViz = Boolean(state.visualizationPayload);
    const contextLines = [
      `User intent: ${state.userIntent}`,
      state.summary ? `Summary: ${state.summary}` : null,
      state.reviewNotes ? `Review notes: ${state.reviewNotes}` : null,
      hasViz ? 'A visualization has been prepared and will appear alongside this response.' : null,
    ]
      .filter(Boolean)
      .join('\n');

    let finalResponse = '';
    for await (const chunk of await llm.stream([
      new SystemMessage(
        'Compose a clear, helpful final response for the user. ' +
          'Be concise and accurate. Do not repeat the intent back verbatim.',
      ),
      new HumanMessage(contextLines),
    ])) {
      finalResponse += typeof chunk.content === 'string' ? chunk.content : '';
    }
    logger.info({ responseLength: finalResponse.length, responsePreview: finalResponse.slice(0, 300) }, 'composeFinalResponse: LLM output');
    return { finalResponse };
  }

  // ── Stream Final Response  (passthrough → END) ───────────────────────────
  async function streamFinalResponse(state: AgentState): Promise<Partial<AgentState>> {
    logger.info(
      {
        responseLength: state.finalResponse?.length ?? 0,
        response: state.finalResponse,
        strategy: state.strategy,
        enoughContext: state.enoughContext,
      },
      'Agent final response',
    );
    return { finalResponse: state.finalResponse };
  }

  return {
    analyzeUserIntent,
    strategyDecision,
    retrieveContext,
    answerFromLightRAG,
    planNextStep,
    disambiguateAskUser,
    generateSqlOrToolCall,
    validateSqlAction,
    executeSqlCallSystem,
    inspectResult,
    decideNextStep,
    callExternalSystem,
    populateVisualizationData,
    renderVisualization,
    summarizeResult,
    humanReview,
    composeFinalResponse,
    streamFinalResponse,
  };
}

// ─── Conditional Edge Functions ───────────────────────────────────────────────

function routeAfterContext(state: AgentState): string {
  // Route to direct answer for 'direct' strategy regardless of context sufficiency
  // so general knowledge questions are never blocked waiting for LightRAG results.
  if (state.strategy === 'direct') return 'answerFromLightRAG';
  return state.enoughContext ? 'answerFromLightRAG' : 'planNextStep';
}

function routeAfterPlan(state: AgentState): string {
  return state.needsUserInput ? 'disambiguateAskUser' : 'generateSqlOrToolCall';
}

function routeAfterValidation(state: AgentState): string {
  if (state.validationStatus === 'valid') return 'executeSqlCallSystem';
  if (
    state.validationStatus === 'invalid_recoverable' &&
    (state.retryCount ?? 0) < 2
  ) {
    return 'generateSqlOrToolCall'; // retry with incremented counter
  }
  return 'humanReview'; // invalid_blocking or max retries exceeded
}

function routeAfterInspect(state: AgentState): string {
  if (state.isUnsafe) return 'humanReview';
  if (!state.taskComplete) return 'decideNextStep';
  return 'populateVisualizationData';
}

function routeAfterDecideNextStep(state: AgentState): string {
  if (state.nextStepDecision === 'human_decision') return 'disambiguateAskUser';
  if (state.nextStepDecision === 'another_system') return 'callExternalSystem';
  return 'generateSqlOrToolCall'; // another_query
}

function routeAfterVisualizationCheck(state: AgentState): string {
  return state.suitableForVisualization ? 'renderVisualization' : 'summarizeResult';
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

function buildGraph(llm: LlmClient, tools: ToolMap, logger: PinoLogger): CompiledStateGraph<AgentState, Partial<AgentState>> {
  const nodes = buildNodes(llm, tools, logger);

  const workflow = new StateGraph(AgentStateSchema)
    // ── Nodes ─────────────────────────────────────────────────────────────
    .addNode('analyzeUserIntent',       nodes.analyzeUserIntent)
    .addNode('strategyDecision',        nodes.strategyDecision)
    .addNode('retrieveContext',         nodes.retrieveContext)
    .addNode('planNextStep',            nodes.planNextStep)
    .addNode('answerFromLightRAG',      nodes.answerFromLightRAG)
    .addNode('disambiguateAskUser',     nodes.disambiguateAskUser)
    .addNode('generateSqlOrToolCall',   nodes.generateSqlOrToolCall)
    .addNode('validateSqlAction',       nodes.validateSqlAction)
    .addNode('executeSqlCallSystem',    nodes.executeSqlCallSystem)
    .addNode('inspectResult',           nodes.inspectResult)
    .addNode('decideNextStep',          nodes.decideNextStep)
    .addNode('callExternalSystem',      nodes.callExternalSystem)
    .addNode('populateVisualizationData', nodes.populateVisualizationData)
    .addNode('renderVisualization',     nodes.renderVisualization)
    .addNode('summarizeResult',         nodes.summarizeResult)
    .addNode('humanReview',             nodes.humanReview)
    .addNode('composeFinalResponse',    nodes.composeFinalResponse)
    .addNode('streamFinalResponse',     nodes.streamFinalResponse)

    // ── Linear edges ──────────────────────────────────────────────────────
    .addEdge(START,                       'analyzeUserIntent')
    .addEdge('analyzeUserIntent',         'strategyDecision')
    .addEdge('strategyDecision',          'retrieveContext')
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

    // ── Conditional edges (diamonds in the flowchart) ─────────────────────
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
      generateSqlOrToolCall: 'generateSqlOrToolCall', // invalid_recoverable retry
      humanReview:           'humanReview',
    })
    .addConditionalEdges('inspectResult', routeAfterInspect, {
      humanReview:              'humanReview',            // unsafe / risky
      decideNextStep:           'decideNextStep',         // task not complete
      populateVisualizationData:'populateVisualizationData', // task complete
    })
    .addConditionalEdges('decideNextStep', routeAfterDecideNextStep, {
      disambiguateAskUser:   'disambiguateAskUser',   // need human decision
      callExternalSystem:    'callExternalSystem',    // need another system
      generateSqlOrToolCall: 'generateSqlOrToolCall', // need another query
    })
    .addConditionalEdges('populateVisualizationData', routeAfterVisualizationCheck, {
      renderVisualization: 'renderVisualization', // suitable visualization
      summarizeResult:     'summarizeResult',     // no suitable visualization
    });

  const memory = new MemorySaver();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return workflow.compile({ checkpointer: memory }) as any;
}

// ─── Service ───────────────────────────────────────────────────────────────────

const STREAMING_NODES = new Set([
  'answerFromLightRAG',
  'disambiguateAskUser',
  'composeFinalResponse',
]);

// Resolve the frontend tool name for a LangGraph node, given the current state.
// Returns undefined for pure-routing nodes that have no frontend tool counterpart.
// SQL vs action paths are resolved dynamically so the correct tool is highlighted.
function resolveToolName(nodeName: string, state: AgentState): string | undefined {
  switch (nodeName) {
    case 'retrieveContext':           return 'retrieve_context';
    case 'answerFromLightRAG':        return 'answer_from_context';
    case 'disambiguateAskUser':       return 'clarification_request';
    case 'generateSqlOrToolCall':     return state.strategy === 'sql' ? 'generate_sql' : 'generate_action';
    case 'validateSqlAction':         return state.generatedSql ? 'validate_sql' : 'validate_action';
    case 'executeSqlCallSystem':      return state.generatedSql ? 'execute_sql' : 'execute_system_action';
    case 'callExternalSystem':        return 'execute_system_action';
    case 'inspectResult':             return 'inspect_result';
    case 'populateVisualizationData': return 'prepare_visualization_data';
    case 'renderVisualization':       return 'render_visualization';
    case 'summarizeResult':           return 'summarize_result';
    case 'humanReview':               return 'human_review_gate';
    case 'composeFinalResponse':      return 'compose_final_response';
    default:                          return undefined;
  }
}

function extractNodeArgs(nodeName: string, state: AgentState): Record<string, unknown> {
  const action = state.generatedAction as Record<string, unknown> | undefined;
  switch (nodeName) {
    case 'retrieveContext':
      return { query: state.userIntent ?? state.messages.at(-1)?.content ?? '', mode: 'hybrid', strategy: state.strategy };
    case 'answerFromLightRAG':
      return { intent: state.userIntent, documentCount: state.retrievedContext?.documents?.length ?? 0, enoughContext: state.enoughContext };
    case 'disambiguateAskUser':
      return { intent: state.userIntent, plan: state.currentPlan };
    case 'generateSqlOrToolCall':
      return state.strategy === 'sql'
        ? { intent: state.userIntent, dialect: state.sqlDialect ?? 'postgres', strategy: 'sql', retry: state.retryCount }
        : { intent: state.userIntent, strategy: state.strategy, system: state.strategy === 'system_tool' ? 'calculator' : 'generic_search' };
    case 'validateSqlAction':
      return state.generatedSql
        ? { sql: state.generatedSql, dialect: state.sqlDialect }
        : { toolName: action?.toolName, input: action?.input };
    case 'executeSqlCallSystem':
      return state.generatedSql
        ? { sql: state.generatedSql }
        : { toolName: action?.toolName, input: action?.input };
    case 'callExternalSystem':
      return { intent: state.userIntent, hasPreviousResult: state.executionResult !== undefined };
    case 'inspectResult':
      return { intent: state.userIntent, hasResult: state.executionResult !== undefined };
    case 'populateVisualizationData':
      return { hasResult: state.executionResult !== undefined, dataShape: state.inspectionDataShape };
    case 'renderVisualization':
      return { componentType: state.visualizationComponentType, props: state.visualizationProps };
    case 'summarizeResult':
      return { intent: state.userIntent, hasResult: state.executionResult !== undefined };
    case 'humanReview':
      return { reason: state.validationReason, riskLevel: state.isUnsafe ? 'high' : 'medium', sql: state.generatedSql };
    case 'composeFinalResponse':
      return { intent: state.userIntent, hasSummary: Boolean(state.summary), hasVisualization: Boolean(state.visualizationPayload), reviewNotes: state.reviewNotes };
    default:
      return {};
  }
}

function summarizeNodeOutput(nodeName: string, output: Partial<AgentState>): unknown {
  const genAction = output.generatedAction as Record<string, unknown> | undefined;
  const vizPayload = output.visualizationPayload as Record<string, unknown> | undefined;
  switch (nodeName) {
    case 'retrieveContext': {
      const docs = output.retrievedContext?.documents ?? [];
      const items = docs.map((d) => ({
        title: d.title ?? d.id ?? 'Unknown',
        source: d.source,
        score: typeof d.score === 'number' ? Math.round(d.score * 100) / 100 : undefined,
      }));
      const sources = items
        .map((it) => it.source)
        .filter((s): s is string => Boolean(s))
        .slice(0, 8);
      return {
        sufficient: output.retrievedContext?.sufficient,
        documentCount: docs.length,
        items,
        sources,
        summary: output.retrievedContext?.contextSummary,
      };
    }
    case 'answerFromLightRAG':
    case 'disambiguateAskUser':
      return { responseLength: output.finalResponse?.length ?? 0 };
    case 'generateSqlOrToolCall':
      return output.generatedSql
        ? { type: 'sql', sql: output.generatedSql, dialect: output.sqlDialect }
        : { type: 'action', toolName: genAction?.toolName, input: genAction?.input };
    case 'validateSqlAction':
      return { status: output.validationStatus, reason: output.validationReason, isUnsafe: output.isUnsafe };
    case 'executeSqlCallSystem':
    case 'callExternalSystem':
      return output.executionResult;
    case 'inspectResult':
      return { complete: output.taskComplete, dataShape: output.inspectionDataShape };
    case 'populateVisualizationData':
      return { suitable: output.suitableForVisualization, componentType: output.visualizationComponentType };
    case 'renderVisualization':
      return { rendered: vizPayload !== undefined, componentType: vizPayload?.componentType };
    case 'summarizeResult':
      return { summary: output.summary };
    case 'humanReview':
      return { reviewNotes: output.reviewNotes };
    case 'composeFinalResponse':
      return { responseLength: output.finalResponse?.length ?? 0 };
    default:
      return output;
  }
}

@Injectable()
export class ChatService implements OnModuleInit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private app!: CompiledStateGraph<AgentState, Partial<AgentState>, any>;

  constructor(
    @InjectPinoLogger(ChatService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  onModuleInit(): void {
    const llm = this.modelProvider.getChatModel();
    const tools = this.toolRegistry.getAll();
    this.app = buildGraph(llm, tools, this.logger);
    this.logger.info('Agent graph compiled and ready');
  }

  stream(dto: ChatRequestDto, res: Response): void {
    const messages = dto.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const initialState: AgentState = {
      messages,
      retryCount: 0,
    };

    const threadId = randomUUID();
    const config = { configurable: { thread_id: threadId }, recursionLimit: 50 };

    this.logger.info({ threadId, messageCount: messages.length }, 'Chat stream started');

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        // AI SDK v6 UIMessageStreamWriter: text parts require text-start → text-delta → text-end
        // with a stable id per part. We track one active text part per node.
        const textPartIds = new Map<string, string>();      // nodeName → part id
        const toolCallIds = new Map<string, string>();      // nodeName → toolCallId
        const resolvedToolNames = new Map<string, string>(); // nodeName → resolved tool name

        const startTextPart = (nodeName: string) => {
          if (!textPartIds.has(nodeName)) {
            const id = randomUUID();
            textPartIds.set(nodeName, id);
            writer.write({ type: 'text-start', id });
          }
        };

        const endAllTextParts = () => {
          for (const [, id] of textPartIds) {
            writer.write({ type: 'text-end', id });
          }
          textPartIds.clear();
        };

        try {
          const eventStream = this.app.streamEvents(initialState, {
            ...config,
            version: 'v2',
          });

          for await (const event of eventStream) {
            const nodeName = event.metadata?.langgraph_node as string | undefined;

            // Log node transitions
            if (event.event === 'on_chain_start' && event.name) {
              this.logger.debug({ threadId, node: event.name }, 'Node started');
            }
            if (event.event === 'on_chain_end' && event.name) {
              this.logger.debug({ threadId, node: event.name }, 'Node completed');
            }

            // Announce tool-node execution to the frontend tool UI
            if (event.event === 'on_chain_start' && event.name) {
              const nodeState = event.data?.input as AgentState | undefined;
              const toolName = nodeState ? resolveToolName(event.name, nodeState) : undefined;
              if (toolName) {
                const toolCallId = randomUUID();
                toolCallIds.set(event.name, toolCallId);
                resolvedToolNames.set(event.name, toolName);
                const input = nodeState ? extractNodeArgs(event.name, nodeState) : {};
                this.logger.info({ threadId, toolName, input }, 'Tool node executing');
                writer.write({ type: 'tool-input-available', toolCallId, toolName, input });

                // Emit an initial streaming delta for retrieve_context so the
                // frontend has something to show while LightRAG is being queried.
                if (toolName === 'retrieve_context' && input.query) {
                  const query = String(input.query);
                  const mode = input.mode ? ` (${String(input.mode)})` : '';
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  writer.write({ type: 'tool-output-delta', toolCallId, delta: `Searching knowledge base${mode} for: "${query}"…` } as any);
                }
              }
            }

            // Deliver tool-node output to the frontend tool UI
            if (event.event === 'on_chain_end' && event.name && toolCallIds.has(event.name)) {
              const toolCallId = toolCallIds.get(event.name)!;
              const toolName = resolvedToolNames.get(event.name)!;
              toolCallIds.delete(event.name);
              resolvedToolNames.delete(event.name);
              const output = event.data?.output as Partial<AgentState> | undefined;
              const summary = summarizeNodeOutput(event.name, output ?? {});
              this.logger.info({ threadId, node: event.name, toolName, summary }, 'Tool node result');
              const deltaText = typeof summary === 'string'
                ? summary
                : JSON.stringify(summary, null, 2);
              // tool-output-delta is intercepted by streaming-fetch.ts before the AI SDK sees it
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              writer.write({ type: 'tool-output-delta', toolCallId, delta: deltaText } as any);
              writer.write({ type: 'tool-output-available', toolCallId, output: summary });
            }

            // Stream text deltas from LLM-generating nodes
            if (event.event === 'on_chat_model_stream' && nodeName) {
              const content = (event.data?.chunk as { content?: unknown })?.content;
              let delta = '';
              if (typeof content === 'string' && content) {
                delta = content;
              } else if (Array.isArray(content)) {
                for (const block of content as Array<{ type?: string; text?: string }>) {
                  if (block.type === 'text' && block.text) delta += block.text;
                }
              }

              if (delta) {
                // Route to main message for terminal streaming nodes
                if (STREAMING_NODES.has(nodeName)) {
                  startTextPart(nodeName);
                  const id = textPartIds.get(nodeName)!;
                  writer.write({ type: 'text-delta', id, delta });
                }

                // Route into tool group UI for all tracked nodes
                if (toolCallIds.has(nodeName)) {
                  const toolCallId = toolCallIds.get(nodeName)!;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  writer.write({ type: 'tool-output-delta', toolCallId, delta } as any);
                }
              }
            }

            // Close the text part when a streaming node finishes
            if (event.event === 'on_chain_end' && event.name && textPartIds.has(event.name)) {
              const id = textPartIds.get(event.name)!;
              writer.write({ type: 'text-end', id });
              textPartIds.delete(event.name);
            }

            // Emit visualization payload as AI SDK data part when the node completes
            if (event.event === 'on_chain_end' && event.name === 'renderVisualization') {
              try {
                const nodeOutput = event.data?.output as Partial<AgentState> | undefined;
                const ds = nodeOutput?.visualizationPayload as DataSpecPayload | undefined;
                if (ds?.componentType) {
                  writer.write({
                    type: 'data-spec',
                    data: { componentType: ds.componentType, props: ds.props },
                  });
                }
              } catch {
                // ignore malformed visualization output
              }
            }
          }

          endAllTextParts();
          this.logger.info({ threadId }, 'Chat stream completed');
        } catch (err) {
          endAllTextParts();
          const message = err instanceof Error ? err.message : 'An unexpected error occurred';
          this.logger.error({ threadId, err }, 'Chat stream error');
          writer.write({ type: 'error', errorText: message });
        }
      },
    });

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream });
  }
}
