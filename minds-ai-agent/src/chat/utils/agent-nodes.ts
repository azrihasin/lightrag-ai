import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import * as jmespath from 'jmespath';
import type { PinoLogger } from 'nestjs-pino';
import type { ModelProvider } from '../providers/model.provider';
import type { AgentState, ToolMap } from './agent-state';
import type { AgentConfig, NodeCustomEvent, SqlTableResultEvent } from './agent-types';
import { callTool, extractDelta, parseJsonFromRaw, streamText } from './agent.utils';
import { CATALOG_SPEC, JMESPATH_FORMAT, SELECTION_RULES } from './visualization.catalog';

export function emit(config: AgentConfig | undefined, event: NodeCustomEvent | SqlTableResultEvent): void {
  config?.writer?.(event);
}

export function buildNodes(toolMap: ToolMap, logger: PinoLogger, modelProvider: ModelProvider) {

  async function analyzeUserIntent(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'analyzeUserIntent' });
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

  async function strategyDecision(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'strategyDecision' });
    const VALID_STRATEGIES = ['direct', 'sql', 'system_tool', 'hybrid', 'unknown', 'data_crosscheck', 'data_passthrough'] as const;
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const userMessage = lastUser?.content ?? '';
    const strategyModel = modelProvider.getChatModel(['strategyDecision']);
    const raw = await streamText(strategyModel, [
      new SystemMessage(
        'Select the best execution strategy for the given intent and user message.\n\n' +
        'STRATEGY OPTIONS:\n' +
        '- "sql"              = needs a database query to retrieve data — use this for ANY request\n' +
        '                       that involves fetching, listing, counting, filtering, or aggregating records.\n' +
        '                       When in doubt between "sql" and "direct", choose "sql".\n' +
        '- "system_tool"      = needs a calculator, search engine, or external API\n' +
        '- "direct"           = can be answered from general knowledge with NO database access needed\n' +
        '                       (e.g. explaining concepts, definitions, or formatting help — NOT data retrieval)\n' +
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

  async function retrieveContext(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'retrieveContext' });
    const tools = [toolMap['retrieve_context']];
    const userIntent = state.userIntent ?? state.messages.at(-1)?.content ?? '';
    const query =
      `You are helping a text-to-SQL agent construct a SQL query. ` +
      `Retrieve only the database schema information (table names, column names, data types, relationships, and constraints) ` +
      `that is relevant to fulfilling this user request: "${userIntent}". ` +
      `Do not answer the user request directly. Only return schema definitions needed to write the SQL query.`;
    const result = await callTool<{ documents: unknown[]; query: string; sufficient: boolean; contextSummary?: string }>(
      tools[0], { query, mode: 'mix', topK: 10 },
    );
    return { retrievedContext: result, enoughContext: result.sufficient };
  }

  async function answerFromLightRAG(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'answerFromLightRAG' });
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

  async function planNextStep(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'planNextStep' });
    const planModel = modelProvider.getChatModel(['planNextStep']);
    const raw = await streamText(planModel, [
      new SystemMessage(
        'Plan the next step for fulfilling the user intent.\n\n' +
        'CRITICAL RULE: When strategy is "sql", "system_tool", or "hybrid", you MUST set needsUserInput=false ' +
        'and write a plan that describes the SQL query or tool call to execute. ' +
        'Never ask the user for clarification when data can be fetched from the database.\n\n' +
        'Set needsUserInput=true ONLY when a specific required value (e.g. a secret credential or ' +
        'a highly specific filter that cannot be inferred at all) is completely unknown. ' +
        'Missing table names, column names, or general data requests are NOT reasons to ask the user — ' +
        'attempt the query using available schema context.\n\n' +
        'When in doubt, set needsUserInput=false and proceed.' +
        '\n\nReply with a single JSON object only. No markdown fences.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\nStrategy: "${state.strategy}"\nSchema context: "${state.retrievedContext?.contextSummary ?? 'none'}"`),
    ], config);
    return parseJsonFromRaw(raw, z.object({
      currentPlan: z.string().optional().default('').describe('One-sentence plan for the next action'),
      needsUserInput: z.boolean().optional().default(false).describe('true ONLY if a specific required value is completely missing and cannot be assumed'),
    }));
  }

  async function disambiguateAskUser(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'disambiguateAskUser' });
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

  async function generateSqlOrToolCall(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'generateSqlOrToolCall' });
    const tools = [toolMap['generate_sql']];
    const retryCount = (state.retryCount ?? 0) + (state.validationStatus != null ? 1 : 0);

    const contextDocs = state.retrievedContext?.documents ?? [];
    const schemaContext = contextDocs
      .map((d: any) => (typeof d.content === 'string' ? d.content : ''))
      .filter((c: string) => c.trim().length > 0)
      .join('\n\n---\n\n');
    const schemaHint = schemaContext || state.retrievedContext?.contextSummary;

    try {
      const result = await callTool<{ actionId: string; sql: string; dialect: string }>(
        tools[0], { intent: state.userIntent ?? '', dialect: 'mysql', schemaHint, rationale: state.currentPlan },
      );
      emit(config, { type: 'node:progress', node: 'generateSqlOrToolCall', step: 'sql-query', data: { sql: result.sql, dialect: result.dialect } });
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

  async function validateSqlAction(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'validateSqlAction' });
    const tools = [toolMap['validate_sql'], toolMap['validate_action']];

    if (!state.generatedSql && !state.generatedAction) {
      return {};
    }

    if (state.generatedSql) {
      const result = await callTool<{ status: string; reason: string; riskLevel: string }>(
        tools[0], { actionId: state.currentActionId ?? randomUUID(), sql: state.generatedSql, dialect: state.sqlDialect ?? 'postgres' },
      );
      return { validationStatus: result.status as AgentState['validationStatus'], validationReason: result.reason, isUnsafe: result.riskLevel === 'high' };
    }

    const action = state.generatedAction as { actionId: string; toolName: string; input: Record<string, unknown> };
    const result = await callTool<{ status: string; reason: string }>(
      tools[1], { actionId: action.actionId, toolName: action.toolName, input: action.input },
    );
    return { validationStatus: result.status as AgentState['validationStatus'], validationReason: result.reason };
  }

  async function executeSqlCallSystem(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'executeSqlCallSystem' });
    const tools = [toolMap['execute_sql'], toolMap['execute_system_action']];

    if (state.generatedSql) {
      const result = await callTool<{
        actionId: string;
        sql: string;
        rows: Record<string, unknown>[];
        columns: string[];
        rowCount: number;
        durationMs: number;
        success: boolean;
      }>(tools[0], { actionId: state.currentActionId ?? randomUUID(), sql: state.generatedSql });

      emit(config, { type: 'node:progress', node: 'executeSqlCallSystem', step: 'sql-table-start', data: { columns: result.columns } });
      for (const row of result.rows) {
        emit(config, { type: 'node:progress', node: 'executeSqlCallSystem', step: 'sql-table-row', data: { row } });
      }
      emit(config, { type: 'node:progress', node: 'executeSqlCallSystem', step: 'sql-table-end', data: { rowCount: result.rowCount } });

      const summaryModel = modelProvider.getChatModel(['executeSqlCallSystem']);
      emit(config, { type: 'node:progress', node: 'executeSqlCallSystem', step: 'token', data: '\n' });
      for await (const chunk of await summaryModel.stream([
        new SystemMessage(
          'You are a data assistant. Summarize a SQL query result in one concise sentence. ' +
          'Mention the number of rows, key columns, and query duration. No markdown, no code blocks.',
        ),
        new HumanMessage(
          `Rows: ${result.rowCount}\nColumns: ${result.columns.join(', ')}\nDuration: ${result.durationMs}ms`,
        ),
      ])) {
        const token = extractDelta(chunk.content);
        if (token) emit(config, { type: 'node:progress', node: 'executeSqlCallSystem', step: 'token', data: token });
      }

      return {
        executionResult: {
          actionId: result.actionId,
          sql: result.sql,
          columns: result.columns,
          rowCount: result.rowCount,
          durationMs: result.durationMs,
          success: result.success,
        },
        sqlRows: result.rows,
      };
    }

    const action = state.generatedAction as { actionId: string; toolName: string; input: Record<string, unknown> };
    const result = await callTool(tools[1], { actionId: action.actionId, toolName: action.toolName, input: action.input });
    return { executionResult: result };
  }

  async function decideNextStep(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'decideNextStep' });
    const decideModel = modelProvider.getChatModel(['decideNextStep']);
    const raw = await streamText(decideModel, [
      new SystemMessage(
        'Decide the next step based on the result. ' +
        'You MUST reply with exactly this JSON shape and no other text:\n' +
        '{"nextStepDecision": "<value>"}\n\n' +
        'Valid values (use exactly as written):\n' +
        '- "done"            → task is complete, proceed to results\n' +
        '- "another_query"   → run another data query\n' +
        '- "another_system"  → call an external system/API\n\n' +
        'No markdown fences. No extra keys.',
      ),
      new HumanMessage(`Intent: "${state.userIntent}"\nCurrent result: ${JSON.stringify(state.executionResult)}\nPlan: "${state.currentPlan ?? 'none'}"`),
    ], config);
    const nextStepDecisionEnum = z.enum(['another_query', 'another_system', 'done']);
    const VALID_DECISIONS = ['another_query', 'another_system', 'done'];
    return parseJsonFromRaw(raw, z.object({
      nextStepDecision: z.preprocess(
        (val) => (VALID_DECISIONS.includes(val as string) ? val : 'done'),
        nextStepDecisionEnum,
      ),
    }));
  }

  async function callExternalSystem(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'callExternalSystem' });
    const tools = [toolMap['execute_system_action']];
    const result = await callTool(
      tools[0], { actionId: randomUUID(), toolName: 'external_api', input: { endpoint: '/api/external', query: state.userIntent, previousResult: state.executionResult } },
    );
    return { executionResult: result };
  }

  async function prepareUserDataForVisualization(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'prepareUserDataForVisualization' });
    const data = state.userProvidedData;
    const rows = Array.isArray(data) ? data : (data != null ? [data] : []);
    return {
      executionResult: { rows, success: true, actionId: randomUUID(), durationMs: 0, rowCount: rows.length },
      taskComplete: true,
      inspectionDataShape: { type: 'user_provided', rowCount: rows.length },
    };
  }

  async function populateVisualizationData(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'populateVisualizationData' });

    const execResult = state.executionResult as { columns?: string[]; rowCount?: number } | undefined;
    const sqlRows = state.sqlRows ?? [];
    const vizModel = modelProvider.getChatModel(['populateVisualizationData']);

    const raw = await streamText(vizModel, [
      new SystemMessage(
        'You are a data visualization expert using the json-render catalog.\n' +
        'Given a SQL execution result, select the best chart component and generate a JMESPath query to extract the data.\n\n' +
        CATALOG_SPEC + '\n\n' + SELECTION_RULES + '\n\n' + JMESPATH_FORMAT,
      ),
      new HumanMessage(
        `Execution result: ${JSON.stringify({ columns: execResult?.columns, rowCount: execResult?.rowCount, sampleRows: sqlRows.slice(0, 5) })}\n` +
        `Data shape: ${JSON.stringify(state.inspectionDataShape)}\n` +
        `User intent: ${state.userIntent ?? ''}`,
      ),
    ], config);

    try {
      const parsed = parseJsonFromRaw(raw, z.object({
        suitable: z.boolean(),
        component: z.string().optional(),
        jmespathQuery: z.string().optional(),
        staticProps: z.record(z.string(), z.any()).optional(),
      }));

      if (!parsed.suitable || !parsed.component || !parsed.jmespathQuery) {
        return { suitableForVisualization: false };
      }

      const jmespathSource = { rows: sqlRows, columns: execResult?.columns ?? [], rowCount: execResult?.rowCount ?? 0 };
      const data = jmespath.search(jmespathSource, parsed.jmespathQuery);
      const props = { ...(parsed.staticProps ?? {}), data };

      return {
        suitableForVisualization: true,
        visualizationComponentType: parsed.component,
        visualizationProps: props,
      };
    } catch (err) {
      logger.warn({ err }, 'populateVisualizationData: failed, falling back to no visualization');
      return { suitableForVisualization: false };
    }
  }

  async function decideVisualizationResult(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'decideVisualizationResult' });

    const execResult = state.executionResult as { columns?: string[]; rowCount?: number } | undefined;
    const sqlRows = state.sqlRows ?? [];
    const sql = state.generatedSql ?? '';
    const decideModel = modelProvider.getChatModel(['decideVisualizationResult']);

    try {
      // No config — don't stream the JSON decision tokens to the UI
      const rawResponse = await decideModel.invoke([
        new SystemMessage(
          'You are a data visualization expert using the json-render catalog.\n' +
          'Given a SQL query and its execution result, select the best chart component and generate a JMESPath query to extract the data.\n\n' +
          CATALOG_SPEC + '\n\n' + SELECTION_RULES + '\n\n' + JMESPATH_FORMAT,
        ),
        new HumanMessage(
          `SQL Query:\n${sql}\n\n` +
          `Execution result: ${JSON.stringify({ columns: execResult?.columns, rowCount: execResult?.rowCount, sampleRows: sqlRows.slice(0, 5) })}\n` +
          `User intent: ${state.userIntent ?? ''}`,
        ),
      ]);

      const raw = extractDelta(rawResponse.content);
      const parsed = parseJsonFromRaw(raw, z.object({
        suitable: z.boolean(),
        component: z.string().optional(),
        jmespathQuery: z.string().optional(),
        staticProps: z.record(z.string(), z.any()).optional(),
      }));

      if (!parsed.suitable || !parsed.component || !parsed.jmespathQuery) {
        return { suitableForVisualization: false };
      }

      // Emit the decided query immediately so the frontend can show the code block during streaming
      emit(config, { type: 'node:progress', node: 'decideVisualizationResult', step: 'jmespath-query', data: { query: parsed.jmespathQuery, component: parsed.component } });

      // Stream summary with config so tokens flow via LangGraph messages mode → tool-output-delta
      const summaryModel = modelProvider.getChatModel(['decideVisualizationResult']);
      for await (const _chunk of await summaryModel.stream([
        new SystemMessage(
          'You are a data assistant. In 2 sentences, explain the visualization decision. ' +
          'Mention the chart component chosen and why it fits the data. No markdown, no code blocks.',
        ),
        new HumanMessage(
          `SQL: ${sql}\nChosen component: ${parsed.component}\nJMESPath query: ${parsed.jmespathQuery}\nUser intent: ${state.userIntent ?? ''}`,
        ),
      ], config)) {
        // Tokens are forwarded automatically via LangGraph messages stream mode
      }

      const jmespathSource = { rows: sqlRows, columns: execResult?.columns ?? [], rowCount: execResult?.rowCount ?? 0 };
      const data = jmespath.search(jmespathSource, parsed.jmespathQuery);
      const props = { ...(parsed.staticProps ?? {}), data };

      return {
        suitableForVisualization: true,
        visualizationComponentType: parsed.component,
        visualizationProps: props,
        visualizationJmespathQuery: parsed.jmespathQuery,
      };
    } catch (err) {
      logger.warn({ err }, 'decideVisualizationResult: failed, falling back to no visualization');
      return { suitableForVisualization: false };
    }
  }

  async function renderVisualization(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'renderVisualization' });
    const tools = [toolMap['render_visualization']];
    const result = await callTool<{ rendered: boolean; dataSpec: import('../dto/sse-event.dto').DataSpecPayload }>(
      tools[0], { componentType: state.visualizationComponentType ?? 'text', props: state.visualizationProps ?? {} },
    );
    return { visualizationPayload: result.dataSpec };
  }

  async function summarizeResult(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'summarizeResult' });
    const tools = [toolMap['summarize_result']];
    const result = await callTool<{ summary: string }>(
      tools[0], { result: state.executionResult, intent: state.userIntent ?? '' },
    );
    return { summary: result.summary };
  }

  async function composeFinalResponse(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'composeFinalResponse' });
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

    return { finalResponse };
  }

  async function streamFinalResponse(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    emit(config, { type: 'node:start', node: 'streamFinalResponse' });
    logger.info(
      { responseLength: state.finalResponse?.length ?? 0, response: state.finalResponse, strategy: state.strategy, enoughContext: state.enoughContext },
      'Agent final response',
    );
    return { finalResponse: state.finalResponse };
  }

  return {
    analyzeUserIntent, strategyDecision, retrieveContext, answerFromLightRAG,
    planNextStep, disambiguateAskUser, generateSqlOrToolCall, validateSqlAction,
    executeSqlCallSystem, decideVisualizationResult, decideNextStep, callExternalSystem,
    prepareUserDataForVisualization, populateVisualizationData, renderVisualization,
    summarizeResult, composeFinalResponse, streamFinalResponse,
  };
}
