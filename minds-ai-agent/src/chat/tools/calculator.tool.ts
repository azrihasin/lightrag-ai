import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

@Injectable()
export class CalculatorTool {
  asTool() {
    return createTool({
      id: 'calculator',
      description: 'Evaluate a safe mathematical expression.',
      inputSchema: z.object({
        expression: z.string().describe('A math expression using digits, operators, and parentheses'),
      }),
      execute: async (input) => {
        const expr = input.expression;
        if (!/^[\d\s+\-*/().%^,e]+$/i.test(expr)) {
          return { error: 'Expression contains disallowed characters.' };
        }
        const raw = new Function(`"use strict"; return (${expr});`)() as unknown;
        return typeof raw === 'number' && isFinite(raw)
          ? { expression: expr, result: parseFloat(raw.toFixed(4)), formatted: raw.toLocaleString('en-US') }
          : { error: 'Expression did not yield a finite number.' };
      },
    });
  }
}
