import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../chat/providers/model.provider';
import { IntentAgentService } from './agents/intent.agent';
import { ContextAgentNetworkService } from './agents/context.agent';
import { GenerateSqlAgentService } from './agents/generate-sql.agent';
import { ValidateSqlAgentService } from './agents/validate-sql.agent';
import { ExecuteSqlAgentService } from './agents/execute-sql.agent';
import { AnalyzeDatasetAgentService } from './agents/analyze-dataset.agent';
import { SummarizeAgentService } from './agents/summarize.agent';
import { VisualizationAgentService } from './agents/visualization.agent';
import { CoverageMapAgentService } from './agents/coverage-map.agent';
import { DataAnalysisTool } from '../ai/mastra/tools/data-analysis.tool';

/** Subagent registry keys → friendly labels for reasoning blocks. */
export const SUBAGENT_LABELS: Record<string, string> = {
  analyze_intent: 'Analyze intent',
  retrieve_context: 'Retrieve schema context (LightRAG)',
  generate_sql: 'Generate SQL (MariaDB)',
  validate_sql: 'Validate SQL',
  execute_sql: 'Execute SQL (MariaDB)',
  analyze_dataset: 'Analyze data (DuckDB)',
  plan_visualization: 'Plan visualization',
  summarize_result: 'Summarize result',
  render_coverage_map: 'Render coverage map',
};

const MASTER_INSTRUCTIONS = [
  'You are the master analytics agent for the MINDS platform (Mobile Intelligent Network Diagnostic System).',
  'You coordinate a team of specialized subagents to answer questions about data in the database.',
  '',
  'CRITICAL RULE — SILENT DELEGATION: When you call subagents, you MUST NOT output ANY text before,',
  'between, or while calling them. Do NOT announce steps. Do NOT write "Step 1:", "Now I will",',
  '"Let me", "I will analyze", or any narration of any kind. Call the subagents directly and silently.',
  '',
  'ROUTING — USER-SUPPLIED DATA (code interpreter): Use the analyze_data tool ONCE, instead of the',
  'database SQL subagent pipeline, whenever the user gives you their OWN data to inspect / clean /',
  'filter / group / aggregate / compute statistics on. This covers three sources:',
  '  1. An uploaded file or pasted dataset — a line like "[Attached dataset(s): fileId=... name=...]"',
  '     appears, or the user clearly means a file/spreadsheet they attached ("this CSV", "the file I',
  '     uploaded"). Pass that fileId to analyze_data.',
  '  2. Raw JSON the user pasted — this is registered for you as an inline dataset and ALSO shows up in',
  '     the "[Attached dataset(s): ...]" marker with a fileId; pass that fileId.',
  '  3. A result set the user wants analyzed further via a read-only SQL query they provide — pass that',
  '     SELECT to analyze_data as `sql` (do NOT also pass a fileId).',
  'Pass EXACTLY ONE of fileId or sql, plus the user\'s full question. analyze_data loads the data into',
  'its own DuckDB table and answers directly with a table and (when useful) a chart.',
  '',
  'ROUTING — COVERAGE / CONGESTION MAPS: Use render_coverage_map ONLY when the user asks for the',
  'network COVERAGE or CONGESTION heat overlay itself (e.g. "show 5G coverage", "show congestion",',
  '"map the TDD coverage", "coverage map for week 8"). These are pre-built tile overlays, NOT a',
  'database query. Delegate ONLY to render_coverage_map (a single call), then write your short final',
  'answer. render_coverage_map shows one week at a time and supports multiple toggleable layers; pass',
  'every layer the user asked for. It does NOT plot individual records.',
  '',
  'ROUTING — PLOTTING RECORDS ON A MAP: If the user asks to list/show/plot specific SITES, CELLS,',
  'LOCATIONS, or any records AS POINTS/MARKERS on a map (e.g. "list 5G sites and show them on the map",',
  '"plot the sites in Selangor", "where are the congested cells"), this IS a database query — run the',
  'FULL data pipeline below. Do NOT use render_coverage_map (it draws no markers). The generate_sql step',
  'must select the latitude and longitude columns so plan_visualization can render a',
  'GeoMap with one marker per row. The keyword "5G" or "map" alone does NOT mean coverage.',
  '',
  'For ANY OTHER question about data in the database (metrics, counts, lists, trends, breakdowns, geospatial data,',
  '"how many", "show me", "what is the average", etc.) you MUST delegate through your subagents in this order:',
  '  analyze_intent → retrieve_context → generate_sql → validate_sql → execute_sql → [analyze_dataset?] → plan_visualization → summarize_result',
  '',
  'Call each subagent in order, normally once each. Pass each subagent what it needs from the previous steps.',
  'generate_sql writes a read-only MariaDB SELECT; validate_sql confirms it is safe; execute_sql runs it against',
  'MariaDB and loads the rows into DuckDB for the visualization step.',
  '',
  'OPTIONAL STEP — analyze_dataset (DuckDB): AFTER execute_sql succeeds and BEFORE plan_visualization, call',
  'analyze_dataset ONLY when the question needs computation beyond what the query already returned — e.g. group',
  'and aggregate, compute averages/rates/percentiles/statistics, derive a new column, rank, filter outliers, or',
  'pivot. It transforms the retrieved dataset in DuckDB and that analyzed result is what gets visualized and',
  'summarized. SKIP it when the query result already answers the question directly (a plain list or a value the',
  'SQL already computed) — do NOT call it just to pass the data through.',
  '',
  'RECOVERY — if a step fails (e.g. execute_sql errors on a bad query), do not give up and do not',
  'jump ahead. Silently retrace the minimum needed to recover: recheck the schema with retrieve_context,',
  'rewrite the query with generate_sql, re-validate with validate_sql, then re-run execute_sql. Keep retries',
  'silent like every other step.',
  'RETRY LIMIT — retry the query AT MOST ONCE (two execute_sql attempts total). If execute_sql still',
  'fails after the second attempt, or it reports the retry limit was reached, STOP retrying and report plainly',
  'that the data could not be retrieved. Never loop the recovery steps beyond this.',
  '',
  'After ALL subagents have finished, write ONE SHORT final answer (1-3 sentences) based on the summary.',
  'Summarize ONLY the final verified outcome. Do NOT replay the failed or retried steps; only mention a',
  'revision if it materially changes what the user should trust about the answer.',
  'Do NOT restate the raw rows, the plan, or the chart spec — those are already shown to the user.',
  'NEVER format any part of your answer as a markdown table (no `|` columns, no `---` separator rows).',
  'The result table is rendered separately below your message; repeating it shows the same data twice.',
  'If the result is shown as a table (a flat list with nothing meaningful to chart), you may note that a',
  'table is the clearest view; do not claim a chart was produced when none was.',
  'Do NOT add any closing remarks or meta-commentary about the steps you took.',
  '',
  'For general questions that are NOT about the database, answer directly without delegating.',
].join('\n');

/**
 * The master multi-agent network. One supervisor `Agent` that delegates to the
 * analytics subagents (exposed as `agent-<id>` tools). The LLM drives the flow;
 * subagents share data out-of-band via the run blackboard (analytics-run.store).
 * Data is RETRIEVED with a read-only MariaDB SELECT (via Drizzle); DuckDB is used
 * ONLY to ingest the retrieved rows and shape/profile the visualization. The LLM
 * only ever sees metadata. Runs WITHOUT Mastra memory — ChatService persists the
 * turn manually to MongoDB.
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
    private readonly analyzeDataset: AnalyzeDatasetAgentService,
    private readonly summarize: SummarizeAgentService,
    private readonly visualization: VisualizationAgentService,
    private readonly coverageMap: CoverageMapAgentService,
    private readonly dataAnalysis: DataAnalysisTool,
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
        analyze_dataset: this.analyzeDataset.agent,
        plan_visualization: this.visualization.agent,
        summarize_result: this.summarize.agent,
        render_coverage_map: this.coverageMap.agent,
      },
      tools: {
        analyze_data: this.dataAnalysis.asTool(),
      },
    } as any);

    this.logger.info('analyticsMaster initialized with MariaDB SQL retrieval + DuckDB visualization pipeline');
  }

  getAgent(): Agent {
    return this.masterAgent;
  }
}
