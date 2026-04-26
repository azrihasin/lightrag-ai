import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class AnswerFromContextTool {
  asTool() {
    return tool({
      description:
        'Provide a direct answer from retrieved LightRAG context when it is sufficient. ' +
        'Call this instead of SQL/tool paths when context alone answers the question. Terminal step.',
      inputSchema: z.object({
        question: z.string(),
        context: z.string().describe('Summarised content from retrieved documents'),
        answerText: z.string().describe('The complete answer to stream to the user'),
        citations: z.array(z.string()).optional().describe('Source IDs referenced'),
      }),
      execute: async ({ question, answerText, citations }) => ({
        answered: true,
        question,
        answer: answerText,
        citations: citations ?? [],
        source: 'lightrag_context',
      }),
    });
  }
}
