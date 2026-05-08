import * as z from 'zod';
import type { ToolRegistry } from '../tools/tool-registry';

export const AgentStateSchema = z.object({
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
  sqlRows: z.array(z.record(z.string(), z.any())).optional(),
  taskComplete: z.boolean().optional(),
  inspectionDataShape: z.any().optional(),
  nextStepDecision: z
    .enum(['another_query', 'another_system', 'done'])
    .optional(),
  suitableForVisualization: z.boolean().optional(),
  visualizationComponentType: z.string().optional(),
  visualizationProps: z.any().optional(),
  visualizationPayload: z.any().optional(),
  visualizationJmespathQuery: z.string().optional(),
  summary: z.string().optional(),
  reviewNotes: z.string().optional(),
  finalResponse: z.string().optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;
export type ToolMap = ReturnType<ToolRegistry['getAll']>;
