import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { ModelProvider } from '../providers/model.provider';
import { ToolRegistry } from '../tools/tool-registry';

const MINDS_CONTEXT =
  'You are an AI assistant for the MINDS Geo-Pro platform, a Mobile Intelligent Network Diagnostic System ' +
  'for Telekom Malaysia. The platform helps users explore mobile network, customer experience, subscriber ' +
  'profiling, and geospatial performance data through natural language.';

@Injectable()
export class MindsAgentService implements OnModuleInit {
  private supervisor!: Agent;

  constructor(
    @InjectPinoLogger(MindsAgentService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  onModuleInit(): void {
    const tools = this.toolRegistry.getAll();
    // Type-cast needed: project uses @ai-sdk v3 (LanguageModelV2) while @mastra/core
    // bundles its own internal version — compatible at runtime but types diverge.
    const model = this.modelProvider.getModel() as any;

    const contextAgent = new Agent({
      id: 'context-agent',
      name: 'ContextAgent',
      instructions:
        'You retrieve database schema context from the LightRAG knowledge base to support SQL generation. ' +
        'Use retrieve_context with a focused, schema-oriented query. ' +
        'If the user intent is ambiguous, call clarification_request first. ' +
        'Once sufficient schema context is found, call answer_from_context to return it.',
      model,
      tools: {
        retrieve_context: tools.retrieve_context,
        answer_from_context: tools.answer_from_context,
        clarification_request: tools.clarification_request,
      },
    });

    const sqlAgent = new Agent({
      id: 'sql-agent',
      name: 'SQLAgent',
      instructions:
        'You generate, validate, and execute SQL SELECT queries against the MINDS MariaDB database.\n' +
        'Follow this strict workflow:\n' +
        '1. Call generate_sql with the user intent and the schema context provided.\n' +
        '2. Call validate_sql on every generated query before execution.\n' +
        '   - If status is "invalid_recoverable": regenerate with a corrected query and validate again.\n' +
        '   - If status is "invalid_blocking": stop immediately and report the reason.\n' +
        '3. Call execute_sql only when validation status is "valid".\n' +
        'Always use LIMIT 50. Never attempt write or DDL operations.',
      model,
      tools: {
        generate_sql: tools.generate_sql,
        validate_sql: tools.validate_sql,
        execute_sql: tools.execute_sql,
      },
    });

    const visualizationAgent = new Agent({
      id: 'viz-agent',
      name: 'VizAgent',
      instructions:
        'You choose the best visualization for SQL query results and render it.\n' +
        '1. Call prepare_visualization_data with the SQL execution result to determine the component type.\n' +
        '2. Call render_visualization with the component type and prepared props.\n' +
        'For geo data (latitude/longitude columns), ensure latField and lngField are correctly mapped. ' +
        'Supported components: table, chart, geo_map, metric-card, list, json-tree.',
      model,
      tools: {
        prepare_visualization_data: tools.prepare_visualization_data,
        render_visualization: tools.render_visualization,
      },
    });

    const memory = new Memory({
      storage: new LibSQLStore({
        id: 'minds-memory-storage',
        url: process.env.MASTRA_DB_URL ?? 'file:mastra.db',
      }),
    });

    this.supervisor = new Agent({
      id: 'minds-supervisor',
      name: 'MINDSSupervisor',
      instructions:
        MINDS_CONTEXT +
        '\n\nYou coordinate three specialized sub-agents to answer user questions:\n' +
        '1. Delegate to ContextAgent — retrieve relevant database schema from LightRAG first.\n' +
        '2. Delegate to SQLAgent — generate, validate, and execute the SQL query using the schema.\n' +
        '3. Delegate to VizAgent — prepare and render the best visualization from the SQL results.\n' +
        '4. For math expressions, use the calculator tool directly.\n' +
        '5. For non-SQL system tasks, use generate_action → validate_action → execute_system_action.\n' +
        '6. Flag high-risk operations with human_review_gate before execution.\n\n' +
        'Your final response must focus on operational insights: root-cause indicators, affected areas, ' +
        'trends, rankings, and recommended next actions. ' +
        'Do NOT mention SQL, queries, table names, or technical database details. ' +
        'Always end with a note that the full result table is shown below.',
      model,
      tools: {
        calculator: tools.calculator,
        generic_search: tools.generic_search,
        generate_action: tools.generate_action,
        validate_action: tools.validate_action,
        execute_system_action: tools.execute_system_action,
        human_review_gate: tools.human_review_gate,
        summarize_result: tools.summarize_result,
      },
      agents: {
        ContextAgent: contextAgent,
        SQLAgent: sqlAgent,
        VizAgent: visualizationAgent,
      },
      memory,
    });

    this.logger.info('Mastra multi-agent supervisor initialized (ContextAgent + SQLAgent + VizAgent)');
  }

  getSupervisor(): Agent {
    return this.supervisor;
  }
}
