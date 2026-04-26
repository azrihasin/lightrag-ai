import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

@Injectable()
export class GenerateActionTool {
  asTool() {
    return tool({
      description:
        'Generate a non-SQL system/tool action for calculations, searches, or synthetic data. ' +
        'Always follow with validate_action before executing.',
      inputSchema: z.object({
        intent: z.string(),
        system: z.enum(['calculator', 'generic_search', 'synthetic_data', 'external_api']),
        params: z.record(z.string(), z.unknown()).describe('Parameters for the target system'),
        rationale: z.string().optional(),
      }),
      execute: async ({ intent, system, params, rationale }) => ({
        actionId: randomUUID(),
        type: 'system_tool' as const,
        toolName: system,
        input: params,
        rationale: rationale ?? `Action targeting ${system} for: ${intent}`,
        requiresValidation: true,
      }),
    });
  }
}
