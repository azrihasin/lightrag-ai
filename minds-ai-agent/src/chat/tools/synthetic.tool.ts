import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const FieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'enum']),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

@Injectable()
export class SyntheticTool {
  asTool() {
    return tool(
      async ({ entityName, fields, rowCount, seed }: {
        entityName: string;
        fields: z.infer<typeof FieldSchema>[];
        rowCount?: number;
        seed?: number;
      }) => {
        const rng = this.makeRng(seed ?? Date.now());
        const rows = Array.from({ length: rowCount ?? 10 }, (_, i) => {
          const row: Record<string, unknown> = { id: i + 1 };
          for (const field of fields) {
            row[field.name] = this.generateValue(field, rng);
          }
          return row;
        });
        return {
          entityName,
          columns: ['id', ...fields.map((f) => f.name)],
          rows,
          rowCount: rows.length,
          schema: fields,
        };
      },
      {
        name: 'synthetic_data',
        description: 'Generate synthetic structured data matching a given schema.',
        schema: z.object({
          entityName: z.string(),
          fields: z.array(FieldSchema).min(1),
          rowCount: z.number().int().min(1).max(200).optional().default(10),
          seed: z.number().int().optional(),
        }),
      },
    );
  }

  private generateValue(field: z.infer<typeof FieldSchema>, rng: () => number): string | number | boolean | null {
    switch (field.type) {
      case 'number': {
        const min = field.min ?? 0;
        const max = field.max ?? 1000;
        return parseFloat((min + rng() * (max - min)).toFixed(2));
      }
      case 'boolean':
        return rng() > 0.5;
      case 'date': {
        const offset = Math.floor(rng() * 365 * 24 * 3600 * 1000);
        return new Date(Date.now() - offset).toISOString().split('T')[0];
      }
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

  private makeRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }
}
