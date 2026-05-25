import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class ClarificationRequestTool {
  asTool() {
    return createTool({
      id: 'clarification_request',
      description: 'Request clarification from the user when intent is ambiguous.',
      inputSchema: z.object({
        question: z.string().describe('The clarification question to ask the user'),
        suggestions: z.array(z.string()).optional().describe('Possible answer options'),
      }),
      execute: async (input) => ({
        clarificationRequested: true,
        question: input.question,
        suggestions: input.suggestions ?? [],
      }),
    });
  }
}
