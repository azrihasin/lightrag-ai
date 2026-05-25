import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class AnswerFromContextTool {
  asTool() {
    return createTool({
      id: 'answer_from_context',
      description: 'Provide a direct answer from the retrieved knowledge-base context.',
      inputSchema: z.object({
        question: z.string(),
        context: z.string().describe('Retrieved context text'),
      }),
      execute: async (input) => ({
        answered: true,
        question: input.question,
        context: input.context,
      }),
    });
  }
}
