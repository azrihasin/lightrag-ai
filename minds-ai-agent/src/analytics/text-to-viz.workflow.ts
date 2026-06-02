import { Injectable, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { DRIZZLE } from '../database/database.module';
import { ModelProvider } from '../chat/providers/model.provider';
import { ContextAgentService } from './context-agent.service';
import { SqlAgentService } from '../ai/mastra/agents/sql.agent';
import { JsonRenderSchemaService } from '../ai/mastra/visualization/json-render.schema';
import type {
  IntentAnalysis,
  RetrievedContext,
  SqlGenerationResult,
  SqlValidationResult,
  ExecutionResult,
  WorkflowOutput,
  WorkflowStepKey,
  WorkflowStepReporter,
  VisualizationSpec,
} from './analytics.types';

/** Fresh result of re-running a persisted query on demand (rerun card). */
export type ReexecuteResult = {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  spec?: VisualizationSpec;
};

const STEP_LABELS: Record<WorkflowStepKey, string> = {
  analyze_intent: 'Analyze intent',
  retrieve_context: 'Retrieve schema context (LightRAG)',
  generate_sql: 'Generate SQL',
  validate_sql: 'Validate SQL',
  execute_sql: 'Execute SQL (MariaDB)',
  summarize_result: 'Summarize result',
  generate_visualization: 'Generate visualization',
};

const noopReporter: WorkflowStepReporter = () => {};

const FORBIDDEN_SQL_WORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate',
  'create', 'grant', 'revoke', 'merge', 'call', 'exec',
];

const intentOutputSchema = z.object({
  intentSummary: z.string(),
  requestedVisualization: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
});

const summaryOutputSchema = z.object({
  answer: z.string(),
});

@Injectable()
export class TextToVizWorkflow {
  private readonly intentAgent: Agent;
  private readonly summaryAgent: Agent;

  constructor(
    @InjectPinoLogger(TextToVizWorkflow.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly contextAgent: ContextAgentService,
    private readonly sqlAgent: SqlAgentService,
    private readonly jsonRenderSchema: JsonRenderSchemaService,
    @Inject(DRIZZLE) private readonly db: MySql2Database,
  ) {
    const model = this.modelProvider.getModel() as any;

    this.intentAgent = new Agent({
      id: 'intent-agent',
      name: 'IntentAgent',
      instructions:
        'You analyze user data questions and extract structured intent optimized for LightRAG schema retrieval. ' +
        'Describe the metric, dimension, time grain, filters, and visualization need in business terms. ' +
        'Do NOT invent table names, column names, or database structure.',
      model,
    });

    this.summaryAgent = new Agent({
      id: 'summary-agent',
      name: 'SummaryAgent',
      instructions:
        'You write concise business-language summaries of data query results. ' +
        'Use only the values present in the data. Do not fabricate insights. ' +
        'If there are no rows, explain that no matching data was found.',
      model,
    });
  }

  /**
   * Run the full text-to-viz pipeline. `report` is invoked at the start
   * (`running`) and completion (`complete`/`error`) of each step so callers
   * can stream the pipeline's progress as reasoning blocks.
   */
  async run(
    question: string,
    report: WorkflowStepReporter = noopReporter,
    signal?: AbortSignal,
  ): Promise<WorkflowOutput> {
    this.logger.info({ question }, 'textToVizWorkflow started');

    const begin = (key: WorkflowStepKey) =>
      report({ key, label: STEP_LABELS[key], status: 'running', text: '' });
    const done = (key: WorkflowStepKey, text: string) =>
      report({ key, label: STEP_LABELS[key], status: 'complete', text });

    // Step 1: analyze_intent
    await begin('analyze_intent');
    const intent = await this.analyzeIntent(question);
    this.logger.debug({ intentSummary: intent.intentSummary }, 'analyze_intent done');
    await done(
      'analyze_intent',
      `**Intent:** ${intent.intentSummary}\n\n` +
        `**Visualization:** ${intent.requestedVisualization ?? 'table'}` +
        (intent.assumptions?.length ? `\n\n**Assumptions:** ${intent.assumptions.join('; ')}` : ''),
    );

    // Step 2: retrieve_context
    signal?.throwIfAborted();
    await begin('retrieve_context');
    const schemaQuery = intent.intentSummary || question;
    const context = await this.retrieveContext(schemaQuery, signal);
    this.logger.debug({ sufficient: context.sufficient }, 'retrieve_context done');

    if (!context.sufficient) {
      await report({
        key: 'retrieve_context',
        label: STEP_LABELS.retrieve_context,
        status: 'error',
        text: `Insufficient context: ${context.contextSummary}`,
      });
      throw new Error(
        `Not enough schema or business context to safely generate SQL. ` +
        `LightRAG returned: ${context.contextSummary}`,
      );
    }
    await done(
      'retrieve_context',
      `Retrieved schema context from LightRAG ` +
        `(${context.references.length} reference${context.references.length === 1 ? '' : 's'}).\n\n` +
        `${context.contextSummary}`,
    );

    // Step 3: generate_sql
    signal?.throwIfAborted();
    await begin('generate_sql');
    const lightragContext = context.documents.map(d => d.text).join('\n\n').slice(0, 4000);
    const sqlResult = await this.generateSql(question, lightragContext);
    this.logger.debug({ sql: sqlResult.sql }, 'generate_sql done');

    if (!sqlResult.sql) {
      await report({
        key: 'generate_sql',
        label: STEP_LABELS.generate_sql,
        status: 'error',
        text: `SQL generation failed: ${sqlResult.explanation}`,
      });
      throw new Error(`SQL generation failed: ${sqlResult.explanation}`);
    }
    await done(
      'generate_sql',
      '```sql\n' + sqlResult.sql + '\n```' +
        (sqlResult.explanation ? `\n\n${sqlResult.explanation}` : ''),
    );

    // Step 4: validate_sql
    await begin('validate_sql');
    const validation = this.validateSql(sqlResult.sql);
    this.logger.debug({ valid: validation.valid }, 'validate_sql done');

    if (!validation.valid) {
      await report({
        key: 'validate_sql',
        label: STEP_LABELS.validate_sql,
        status: 'error',
        text: `Validation failed: ${validation.reason}`,
      });
      throw new Error(`SQL validation failed: ${validation.reason}`);
    }
    await done('validate_sql', 'Query passed read-only safety validation.');

    // Step 5: execute_sql
    signal?.throwIfAborted();
    await begin('execute_sql');
    const execResult = await this.executeSql(validation.normalizedSql);
    this.logger.debug({ rowCount: execResult.rowCount }, 'execute_sql done');
    await done(
      'execute_sql',
      `Returned **${execResult.rowCount}** row${execResult.rowCount === 1 ? '' : 's'} ` +
        `in ${execResult.executionMs}ms across ${execResult.columns.length} column(s).`,
    );

    // Step 6: summarize_result
    await begin('summarize_result');
    const answer = await this.summarizeResult(question, execResult, sqlResult.assumptions);
    this.logger.debug({ answerLength: answer.length }, 'summarize_result done');
    await done('summarize_result', answer);

    // Step 7: generate_visualization
    await begin('generate_visualization');
    const visualizationSpec = this.generateVisualization(
      execResult.columns,
      execResult.rowCount,
      intent.requestedVisualization ?? 'table',
    );
    this.logger.debug({ specType: (visualizationSpec as any).type }, 'generate_visualization done');
    await done(
      'generate_visualization',
      `Built a \`${(visualizationSpec as any).type ?? 'Dashboard'}\` visualization spec.`,
    );

    this.logger.info({ rowCount: execResult.rowCount }, 'textToVizWorkflow completed');

    return {
      answer,
      sql: execResult.executedSql,
      rows: execResult.rows,
      columns: execResult.columns,
      visualizationSpec,
      metadata: {
        rowCount: execResult.rowCount,
        contextReferences: context.references,
      },
    };
  }

  /**
   * Re-run a previously generated query on demand and rebuild its visualization
   * with fresh rows. Used by the chat-history "rerun" card: persisted turns keep
   * only the SQL + visualization *structure* (never the row data), so the table
   * and chart are regenerated from a live query instead of stale stored rows.
   */
  async reexecute(rawSql: string, spec?: VisualizationSpec): Promise<ReexecuteResult> {
    const validation = this.validateSql(rawSql);
    if (!validation.valid) {
      throw new Error(`SQL validation failed: ${validation.reason}`);
    }

    const execResult = await this.executeSql(validation.normalizedSql);
    this.logger.info({ rowCount: execResult.rowCount }, 'reexecute completed');

    return {
      columns: execResult.columns,
      rows: execResult.rows,
      rowCount: execResult.rowCount,
      spec: spec ? this.rehydrateSpec(spec, execResult.rows) : undefined,
    };
  }

  /** Re-inject fresh rows into a stored (data-stripped) visualization spec. */
  private rehydrateSpec(
    spec: VisualizationSpec,
    rows: Record<string, unknown>[],
  ): VisualizationSpec {
    const props: Record<string, unknown> = { ...(spec.props ?? {}) };

    // Workflow-style json-render specs carry rows under `dataState.rows`; catalog
    // chart/map components (chat path) embed them inline under `data`.
    if (props.dataState && typeof props.dataState === 'object') {
      props.dataState = { ...(props.dataState as Record<string, unknown>), rows };
    } else {
      props.data = rows;
      const latField = props.latField as string | undefined;
      const lngField = props.lngField as string | undefined;
      if (latField && lngField) {
        props.center = this.computeGeoCenter(rows, latField, lngField);
      }
    }

    return { componentType: spec.componentType, props };
  }

  private computeGeoCenter(
    rows: Record<string, unknown>[],
    latField: string,
    lngField: string,
  ): [number, number] {
    let latSum = 0;
    let lngSum = 0;
    let n = 0;
    for (const row of rows) {
      const lat = Number(row[latField]);
      const lng = Number(row[lngField]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        latSum += lat;
        lngSum += lng;
        n += 1;
      }
    }
    return n > 0 ? [latSum / n, lngSum / n] : [0, 0];
  }

  // ── Step implementations ─────────────────────────────────────────────────────

  private async analyzeIntent(question: string): Promise<IntentAnalysis> {
    const prompt =
      `Analyze this data question and extract structured intent for LightRAG schema retrieval.\n` +
      `Question: "${question}"\n\n` +
      `Describe: the metric requested, dimensions/groupings, time grain if any, filters, ` +
      `and the best visualization type (bar chart, line chart, table, etc.). ` +
      `Do NOT mention specific table or column names.`;

    const result = await this.intentAgent.generate(prompt, {
      structuredOutput: {
        schema: intentOutputSchema,
        jsonPromptInjection: this.modelProvider.needsJsonPromptInjection,
      },
    });

    const parsed = intentOutputSchema.parse(result.object);
    return {
      rawQuestion: question,
      intentSummary: parsed.intentSummary,
      requestedVisualization: parsed.requestedVisualization,
      assumptions: parsed.assumptions,
    };
  }

  private async retrieveContext(
    schemaQuery: string,
    signal?: AbortSignal,
  ): Promise<RetrievedContext> {
    return this.contextAgent.retrieveContext(schemaQuery, signal);
  }

  private async generateSql(
    question: string,
    lightragContext: string,
  ): Promise<SqlGenerationResult> {
    return this.sqlAgent.generate({ question, lightragContext });
  }

  private validateSql(rawSql: string): SqlValidationResult {
    const normalizedSql = rawSql.trim().toLowerCase();

    if (!normalizedSql.startsWith('select') && !normalizedSql.startsWith('with')) {
      return {
        valid: false,
        normalizedSql: rawSql.trim(),
        reason: 'Query must start with SELECT or WITH',
      };
    }

    for (const word of FORBIDDEN_SQL_WORDS) {
      if (normalizedSql.includes(word)) {
        return {
          valid: false,
          normalizedSql: rawSql.trim(),
          reason: `Query contains forbidden keyword: ${word}`,
        };
      }
    }

    return { valid: true, normalizedSql: rawSql.trim() };
  }

  private async executeSql(validatedSql: string): Promise<ExecutionResult> {
    const t0 = Date.now();
    const [rawRows] = await this.db.execute(sql.raw(validatedSql));
    const rows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
    const executionMs = Date.now() - t0;

    const columns =
      rows.length > 0
        ? Object.entries(rows[0]).map(([name, val]) => ({ name, type: typeof val }))
        : [];

    return { rows, rowCount: rows.length, executedSql: validatedSql, columns, executionMs };
  }

  private async summarizeResult(
    question: string,
    execResult: ExecutionResult,
    assumptions: string[],
  ): Promise<string> {
    if (execResult.rowCount === 0) {
      const assumptionNote = assumptions.length > 0
        ? ` Assumptions made: ${assumptions.join('; ')}.`
        : '';
      return `No matching data was found for your question.${assumptionNote}`;
    }

    // Privacy: never send raw database rows to the LLM — only the result's
    // structure (column names + types) and the row count.
    const columnList = execResult.columns
      .map(c => `${c.name} (${c.type})`)
      .join(', ');
    const prompt =
      `User question: "${question}"\n` +
      `Total rows returned: ${execResult.rowCount}\n` +
      `Result columns (name + type): ${columnList}\n\n` +
      `Write a concise summary describing what this result set represents ` +
      `(its columns and how many rows matched). ` +
      `Do NOT invent specific values — you have only the structure, not the data. ` +
      `Keep it under 3 sentences.`;

    const result = await this.summaryAgent.generate(prompt, {
      structuredOutput: {
        schema: summaryOutputSchema,
        jsonPromptInjection: this.modelProvider.needsJsonPromptInjection,
      },
    });

    return summaryOutputSchema.parse(result.object).answer;
  }

  private generateVisualization(
    columns: Array<{ name: string; type: string }>,
    rowCount: number,
    visualizationIntent: string,
  ): Record<string, unknown> {
    const intent = visualizationIntent.toLowerCase();
    const isChart =
      intent.includes('chart') ||
      intent.includes('bar') ||
      intent.includes('line') ||
      intent.includes('pie') ||
      intent.includes('trend');

    if (isChart && columns.length >= 2) {
      const chartType = intent.includes('line')
        ? 'LineChart'
        : intent.includes('pie')
          ? 'PieChart'
          : 'BarChart';

      const spec = {
        type: 'Dashboard',
        children: [
          {
            type: chartType,
            dataPath: '$.rows',
            labelKey: columns[0].name,
            valueKey: columns[1].name,
            title: visualizationIntent,
          },
          {
            type: 'MetricCard',
            label: 'Total Records',
            value: String(rowCount),
          },
        ],
      };

      const validation = this.jsonRenderSchema.validate(spec);
      return validation.valid ? spec : this.jsonRenderSchema.repair(spec);
    }

    const spec = {
      type: 'Dashboard',
      children: [
        {
          type: 'DataTable',
          dataPath: '$.rows',
          columns: columns.map(c => ({
            key: c.name,
            label: c.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          })),
        },
        {
          type: 'MetricCard',
          label: 'Total Records',
          value: String(rowCount),
        },
      ],
    };

    const validation = this.jsonRenderSchema.validate(spec);
    return validation.valid ? spec : this.jsonRenderSchema.repair(spec);
  }
}
