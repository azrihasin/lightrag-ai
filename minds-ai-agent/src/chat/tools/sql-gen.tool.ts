import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class SqlGenTool {
  asTool() {
    return tool(
      async ({ question, dialect }: { question: string; dialect?: string; schema?: string }) => ({
        sql: `SELECT * FROM example_table WHERE condition = 'stub' LIMIT 100;`,
        dialect: dialect ?? 'postgres',
        question,
      }),
      {
        name: 'sql_gen',
        description: 'Generate a SQL query from a natural language question.',
        schema: z.object({
          question: z.string(),
          dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('postgres'),
          schema: z.string().optional(),
        }),
      },
    );
  }
}
