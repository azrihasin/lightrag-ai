import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class CalculatorTool {
  asTool() {
    return tool({
      description: 'Evaluate mathematical expressions or perform numerical computations.',
      inputSchema: z.object({
        expression: z.string(),
        precision: z.number().int().min(0).max(15).optional().default(4),
      }),
      execute: async ({ expression, precision }) => {
        try {
          if (!/^[\d\s+\-*/().%^,e]+$/i.test(expression)) {
            return { error: 'Expression contains disallowed characters.' };
          }
          const raw = new Function(`"use strict"; return (${expression});`)() as unknown;
          if (typeof raw !== 'number' || !isFinite(raw)) {
            return { error: 'Expression did not yield a finite number.' };
          }
          return {
            expression,
            result: parseFloat(raw.toFixed(precision ?? 4)),
            formatted: raw.toLocaleString('en-US', { maximumFractionDigits: precision ?? 4 }),
          };
        } catch (err) {
          return { error: `Evaluation failed: ${(err as Error).message}` };
        }
      },
    });
  }
}
