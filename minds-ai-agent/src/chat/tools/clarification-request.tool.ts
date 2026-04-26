import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class ClarificationRequestTool {
  asTool() {
    return tool({
      description:
        'Ask the user a concise clarification question when ambiguity blocks progress. Terminal step — do not call other tools after this.',
      inputSchema: z.object({
        question: z.string().describe('The clarification question to present to the user'),
        reason: z.string().describe('Internal reason clarification is needed (not shown to user)'),
        suggestions: z.array(z.string()).optional().describe('Suggested answers to guide the user'),
      }),
      execute: async ({ question, reason, suggestions }) => ({
        clarificationRequested: true,
        question,
        reason,
        suggestions: suggestions ?? [],
      }),
    });
  }
}
