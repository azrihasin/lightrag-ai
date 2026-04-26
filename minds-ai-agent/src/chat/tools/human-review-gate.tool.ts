import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class HumanReviewGateTool {
  asTool() {
    return tool({
      description:
        'Flag an action or result for human review when risk is too high for autonomous execution. ' +
        'Terminal step — halts the pipeline and surfaces a guarded response.',
      inputSchema: z.object({
        reason: z.string().describe('Why human review is needed'),
        actionId: z.string().optional(),
        riskLevel: z.enum(['medium', 'high']),
        suggestedResponse: z.string().optional().describe('Safe fallback message to show the user'),
      }),
      execute: async ({ reason, actionId, riskLevel, suggestedResponse }) => ({
        reviewNeeded: true,
        reason,
        actionId: actionId ?? null,
        riskLevel,
        suggestedResponse:
          suggestedResponse ??
          'This request requires human review before I can proceed. Please contact support.',
        timestamp: new Date().toISOString(),
      }),
    });
  }
}
