import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

@Injectable()
export class SqlGenTool {
  asTool() {
    return tool({
      description: 'Generate a SQL query from a natural language question.',
      inputSchema: z.object({
        question: z.string(),
        dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('postgres'),
        schema: z.string().optional(),
      }),
      execute: async ({ question, dialect }) => ({
        sql: `SELECT * FROM example_table WHERE condition = 'stub' LIMIT 100;`,
        dialect: dialect ?? 'postgres',
        question,
      }),
    });
  }
}
