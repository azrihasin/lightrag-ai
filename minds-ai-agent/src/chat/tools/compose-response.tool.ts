import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class ComposeResponseTool {
  asTool() {
    return tool(
      async ({ responseText, summary, citations, hasVisualization }) => ({
        composed: true,
        responseText,
        summary,
        citations: citations ?? [],
        hasVisualization: hasVisualization ?? false,
        timestamp: new Date().toISOString(),
      }),
      {
        name: 'compose_final_response',
        description:
          'Compose the final response text to stream to the user. ' +
          'This is the last step before streaming. Terminal step.',
        schema: z.object({
          responseText: z.string().describe('The complete final response to show the user'),
          summary: z.string().describe('One-sentence internal summary of what was accomplished'),
          citations: z.array(z.string()).optional(),
          hasVisualization: z.boolean().optional().default(false),
        }),
      },
    );
  }
}
