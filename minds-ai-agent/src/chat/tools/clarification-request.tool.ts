import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class ClarificationRequestTool {
  asTool() {
    return tool(
      async ({ question, reason, suggestions }) => ({
        clarificationRequested: true,
        question,
        reason,
        suggestions: suggestions ?? [],
      }),
      {
        name: 'clarification_request',
        description:
          'Ask the user a concise clarification question when ambiguity blocks progress. Terminal step — do not call other tools after this.',
        schema: z.object({
          question: z.string().describe('The clarification question to present to the user'),
          reason: z.string().describe('Internal reason clarification is needed (not shown to user)'),
          suggestions: z.array(z.string()).optional().describe('Suggested answers to guide the user'),
        }),
      },
    );
  }
}
