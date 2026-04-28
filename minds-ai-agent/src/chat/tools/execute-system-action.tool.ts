import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

const FieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function genValue(field: z.infer<typeof FieldSchema>, rng: () => number): unknown {
  switch (field.type) {
    case 'number': {
      const min = field.min ?? 0;
      const max = field.max ?? 1000;
      return parseFloat((min + rng() * (max - min)).toFixed(2));
    }
    case 'boolean':
      return rng() > 0.5;
    case 'date':
      return new Date(Date.now() - Math.floor(rng() * 365 * 86_400_000))
        .toISOString()
        .split('T')[0];
    case 'enum': {
      const vals = field.enumValues ?? ['A', 'B', 'C'];
      return vals[Math.floor(rng() * vals.length)];
    }
    default: {
      const words = ['quick', 'bright', 'calm', 'dark', 'fresh', 'river', 'cloud', 'stone'];
      return `${words[Math.floor(rng() * words.length)]}-${Math.floor(rng() * 999)}`;
    }
  }
}

@Injectable()
export class ExecuteSystemActionTool {
  asTool() {
    return tool({
      description:
        'Execute a validated non-SQL system action. Routes to calculator, generic_search, synthetic_data, or external_api.',
      inputSchema: z.object({
        actionId: z.string(),
        toolName: z.string(),
        input: z.record(z.string(), z.unknown()),
      }),
      execute: async ({ actionId, toolName, input }) => {
        const t0 = Date.now();
        try {
          let result: unknown;

          if (toolName === 'calculator') {
            const expr = String((input as Record<string, unknown>).expression ?? '');
            if (!/^[\d\s+\-*/().%^,e]+$/i.test(expr)) {
              result = { error: 'Expression contains disallowed characters.' };
            } else {
              const raw = new Function(`"use strict"; return (${expr});`)() as unknown;
              result =
                typeof raw === 'number' && isFinite(raw)
                  ? { expression: expr, result: parseFloat(raw.toFixed(4)), formatted: raw.toLocaleString('en-US') }
                  : { error: 'Expression did not yield a finite number.' };
            }
          } else if (toolName === 'generic_search') {
            const query = String((input as Record<string, unknown>).query ?? '');
            const max = Number((input as Record<string, unknown>).maxResults ?? 5);
            result = {
              query,
              results: Array.from({ length: max }, (_, i) => ({
                rank: i + 1,
                title: `Result ${i + 1} for "${query}"`,
                url: `https://example.com/result-${i + 1}`,
                snippet: `Stub result for: ${query}`,
              })),
            };
          } else if (toolName === 'synthetic_data') {
            const inp = input as Record<string, unknown>;
            const fields = (inp.fields as z.infer<typeof FieldSchema>[]) ?? [];
            const rowCount = Number(inp.rowCount ?? 10);
            const rng = makeRng(Number(inp.seed ?? Date.now()));
            const rows = Array.from({ length: rowCount }, (_, i) => {
              const row: Record<string, unknown> = { id: i + 1 };
              for (const f of fields) row[f.name] = genValue(f, rng);
              return row;
            });
            result = {
              entityName: inp.entityName ?? 'entity',
              columns: ['id', ...fields.map((f) => f.name)],
              rows,
              rowCount: rows.length,
              schema: fields,
            };
          } else {
            result = { executed: true, system: toolName, input };
          }

          return { actionId, toolName, result, durationMs: Date.now() - t0, success: true };
        } catch (err: unknown) {
          return {
            actionId,
            toolName,
            result: null,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - t0,
            success: false,
          };
        }
      },
    });
  }
}
