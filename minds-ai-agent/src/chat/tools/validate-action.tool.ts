import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ValidationStatus } from '../agent/agent.state';

const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  calculator: z.object({ expression: z.string() }),
  generic_search: z.object({ query: z.string() }),
  synthetic_data: z.object({
    entityName: z.string(),
    fields: z.array(z.object({ name: z.string(), type: z.string() })).min(1),
  }),
  external_api: z.object({ endpoint: z.string() }),
};

@Injectable()
export class ValidateActionTool {
  asTool() {
    return tool(
      async ({ actionId, toolName, input }): Promise<{ actionId: string; status: ValidationStatus; reason: string }> => {
        const schema = TOOL_SCHEMAS[toolName];
        if (!schema) {
          return { actionId, status: 'invalid_blocking', reason: `Unknown tool: ${toolName}` };
        }
        const result = schema.safeParse(input);
        if (!result.success) {
          return {
            actionId,
            status: 'invalid_recoverable',
            reason: result.error.issues.map((i) => i.message).join('; '),
          };
        }
        return { actionId, status: 'valid', reason: 'Action passed schema validation' };
      },
      {
        name: 'validate_action',
        description:
          'Validate a system/tool action schema before execution. ' +
          'Returns valid | invalid_recoverable | invalid_blocking.',
        schema: z.object({
          actionId: z.string(),
          toolName: z.string(),
          input: z.record(z.string(), z.unknown()),
        }),
      },
    );
  }
}
