import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../chat/providers/model.provider';
import { IntentAgentService } from './agents/intent.agent';
import { ContextAgentNetworkService } from './agents/context.agent';
import { GenerateSqlAgentService } from './agents/generate-sql.agent';
import { ValidateSqlAgentService } from './agents/validate-sql.agent';
import { ExecuteSqlAgentService } from './agents/execute-sql.agent';
import { SummarizeAgentService } from './agents/summarize.agent';
import { VisualizationAgentService } from './agents/visualization.agent';

/** Subagent registry keys → friendly labels for reasoning blocks. */
export const SUBAGENT_LABELS: Record<string, string> = {
  analyze_intent: 'Analyze intent',
  retrieve_context: 'Retrieve schema context (LanceDB)',
  generate_sql: 'Generate SQL',
  validate_sql: 'Validate SQL',
  execute_sql: 'Execute SQL (MariaDB)',
  summarize_result: 'Summarize result',
  generate_visualization: 'Generate visualization',
};

const MASTER_INSTRUCTIONS = [
  'You are the master analytics agent for the MINDS platform (Mobile Intelligent Network Diagnostic System).',
  'You coordinate a team of specialized subagents to answer questions about data in the database.',
  '',
  'CRITICAL RULE — SILENT DELEGATION: When you call subagents, you MUST NOT output ANY text before,',
  'between, or while calling them. Do NOT announce steps. Do NOT write "Step 1:", "Now I will",',
  '"Let me", "I will analyze", or any narration of any kind. Call the subagents directly and silently.',
  '',
  'For ANY question about data in the database (metrics, counts, lists, trends, breakdowns, geospatial data,',
  '"how many", "show me", "what is the average", etc.) you MUST delegate through your subagents in this order:',
  '  analyze_intent → retrieve_context → generate_sql → validate_sql → execute_sql → summarize_result → generate_visualization',
  '',
  'Call each subagent in order, normally once each. Pass each subagent what it needs from the previous steps.',
  'If validate_sql reports the query is unsafe, stop and explain — do not execute.',
  'When asked for a LIST of records, remember the SQL agent will cap it at 10 rows by default.',
  '',
  'RECOVERY — if a step fails (e.g. execute_sql errors on a missing column), do not give up and do not',
  'jump ahead. Silently retrace the minimum needed to recover: recheck the schema with retrieve_context,',
  'revise the query with generate_sql, re-validate, then re-run execute_sql. Keep retries silent like every',
  'other step.',
  '',
  'After ALL subagents have finished, write ONE SHORT final answer (1-3 sentences) based on the summary.',
  'Summarize ONLY the final verified outcome. Do NOT replay the failed or retried steps; only mention a',
  'revision if it materially changes what the user should trust about the answer (e.g. a column they named',
  'does not exist). Describe any failure in plain, user-facing terms — never expose SQL errors, stack traces,',
  'or raw backend details.',
  'Do NOT restate the raw rows, the SQL, or the chart spec — those are already shown to the user.',
  'NEVER format any part of your answer as a markdown table (no `|` columns, no `---` separator rows).',
  'The result table is rendered separately below your message; repeating it as a markdown table shows the',
  'same data twice. Refer to the figures in prose only.',
  'If the result is shown as a table (a flat list with nothing meaningful to chart), you may note that a',
  'table is the clearest view; do not claim a chart was produced when none was.',
  'Do NOT add any closing remarks or meta-commentary about the steps you took.',
  '',
  'For general questions that are NOT about the database, answer directly without delegating.',
].join('\n');

/**
 * The master multi-agent network. One supervisor `Agent` that delegates to the
 * seven analytics subagents (exposed as `agent-<id>` tools). The LLM drives the
 * flow; subagents share row/spec data out-of-band via the run blackboard
 * (see analytics-run.store.ts). Runs WITHOUT Mastra memory — ChatService
 * persists the turn manually to MongoDB.
 */
@Injectable()
export class AnalyticsAgentService implements OnModuleInit {
  private masterAgent!: Agent;

  constructor(
    @InjectPinoLogger(AnalyticsAgentService.name) private readonly logger: PinoLogger,
    private readonly modelProvider: ModelProvider,
    private readonly intent: IntentAgentService,
    private readonly context: ContextAgentNetworkService,
    private readonly generateSql: GenerateSqlAgentService,
    private readonly validateSql: ValidateSqlAgentService,
    private readonly executeSql: ExecuteSqlAgentService,
    private readonly summarize: SummarizeAgentService,
    private readonly visualization: VisualizationAgentService,
  ) {}

  onModuleInit(): void {
    this.masterAgent = new Agent({
      id: 'analytics-master',
      name: 'analyticsMaster',
      instructions: MASTER_INSTRUCTIONS,
      model: this.modelProvider.getModel() as any,
      agents: {
        analyze_intent: this.intent.agent,
        retrieve_context: this.context.agent,
        generate_sql: this.generateSql.agent,
        validate_sql: this.validateSql.agent,
        execute_sql: this.executeSql.agent,
        summarize_result: this.summarize.agent,
        generate_visualization: this.visualization.agent,
      },
    } as any);

    this.logger.info('analyticsMaster initialized with 7 subagents');
  }

  getAgent(): Agent {
    return this.masterAgent;
  }
}
