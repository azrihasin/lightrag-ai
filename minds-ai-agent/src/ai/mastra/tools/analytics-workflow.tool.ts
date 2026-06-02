import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TextToVizWorkflow } from '../../../analytics/text-to-viz.workflow';
import type { WorkflowStepEvent } from '../../../analytics/analytics.types';

/**
 * Chunk emitted for each pipeline step. Surfaces in `agent.stream().fullStream`
 * (wrapped as a `tool-output` chunk) so the chat stream can render it as a
 * ghost reasoning block.
 */
export type AnalyticsStepChunk = WorkflowStepEvent & { kind: 'analytics-step' };

/** Final chunk carrying the table rows + visualization spec for rendering. */
export type AnalyticsRenderChunk = {
  kind: 'analytics-render';
  sql: string;
  /** The pipeline's summarized answer — used as a fallback if the agent emits no text. */
  answer: string;
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  spec: Record<string, unknown>;
};

export type AnalyticsToolChunk = AnalyticsStepChunk | AnalyticsRenderChunk;

const outputSchema = z.object({
  answer: z.string(),
  rowCount: z.number(),
  sql: z.string(),
});

/**
 * Agent-owned tool that runs the full text-to-viz pipeline against MariaDB.
 * The agent decides when to call it; the tool streams each pipeline step and
 * the final render payload through its `writer`, and returns a compact summary
 * to the agent so it can compose the user-facing answer.
 */
@Injectable()
export class AnalyticsWorkflowTool {
  constructor(
    @InjectPinoLogger(AnalyticsWorkflowTool.name) private readonly logger: PinoLogger,
    private readonly workflow: TextToVizWorkflow,
  ) {}

  asTool() {
    return createTool({
      id: 'analytics_workflow',
      description:
        'Answer any question about data stored in the database (metrics, counts, lists, ' +
        'trends, breakdowns, geospatial data, etc.). Runs a text-to-SQL pipeline against ' +
        'MariaDB and returns a summarized answer plus a table and visualization rendered to ' +
        'the user. Call this whenever the user asks about their data.',
      inputSchema: z.object({
        question: z
          .string()
          .describe("The user's full data question, in natural language"),
      }),
      outputSchema,
      execute: async (input: { question: string }, ctx?: { writer?: { write(data: unknown): Promise<void> } }) => {
        const writer = ctx?.writer;
        const emit = (chunk: AnalyticsToolChunk) => writer?.write(chunk);

        this.logger.info({ question: input.question }, 'analytics_workflow invoked');

        const result = await this.workflow.run(input.question, async (step) => {
          await emit({ kind: 'analytics-step', ...step });
        });

        await emit({
          kind: 'analytics-render',
          sql: result.sql,
          answer: result.answer,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.metadata.rowCount,
          spec: result.visualizationSpec,
        });

        return {
          answer: result.answer,
          rowCount: result.metadata.rowCount,
          sql: result.sql,
        };
      },
    });
  }
}
