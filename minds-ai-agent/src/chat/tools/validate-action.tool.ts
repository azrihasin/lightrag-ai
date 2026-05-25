import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const ALLOWED_TOOLS = new Set(['calculator', 'generic_search', 'synthetic_data', 'external_api']);

@Injectable()
export class ValidateActionTool {
  asTool() {
    return createTool({
      id: 'validate_action',
      description: 'Validate a non-SQL system action before execution.',
      inputSchema: z.object({
        actionId: z.string(),
        toolName: z.string(),
        input: z.record(z.string(), z.unknown()),
      }),
      execute: async (params) => {
        const { actionId, toolName } = params;
        if (!ALLOWED_TOOLS.has(toolName)) {
          return { actionId, status: 'invalid_blocking' as const, reason: `Tool "${toolName}" is not allowed.` };
        }
        return { actionId, status: 'valid' as const, reason: 'Action passed validation.' };
      },
    });
  }
}
