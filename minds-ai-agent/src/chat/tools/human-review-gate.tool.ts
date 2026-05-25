import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class HumanReviewGateTool {
  asTool() {
    return createTool({
      id: 'human_review_gate',
      description: 'Flag a high-risk action for human review before execution.',
      inputSchema: z.object({
        actionId: z.string(),
        reason: z.string(),
        riskLevel: z.enum(['low', 'medium', 'high']),
        actionSummary: z.string().optional(),
      }),
      execute: async (input) => ({
        reviewNeeded: true,
        actionId: input.actionId,
        reason: input.reason,
        riskLevel: input.riskLevel,
        actionSummary: input.actionSummary,
      }),
    });
  }
}
