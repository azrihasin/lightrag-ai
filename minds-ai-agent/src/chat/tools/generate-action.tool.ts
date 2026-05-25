import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

@Injectable()
export class GenerateActionTool {
  asTool() {
    return createTool({
      id: 'generate_action',
      description: 'Create a non-SQL system action for calculator, search, synthetic_data, or external_api.',
      inputSchema: z.object({
        intent: z.string(),
        toolName: z.enum(['calculator', 'generic_search', 'synthetic_data', 'external_api']),
        input: z.record(z.string(), z.unknown()),
        rationale: z.string().optional(),
      }),
      execute: async (params) => ({
        actionId: randomUUID(),
        toolName: params.toolName,
        input: params.input,
        rationale: params.rationale ?? params.intent,
        requiresValidation: true,
      }),
    });
  }
}
