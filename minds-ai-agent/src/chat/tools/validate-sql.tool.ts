import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

type ValidationStatus = 'pending' | 'valid' | 'invalid_recoverable' | 'invalid_blocking';

const BLOCK_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|xp_|sp_)\b/i;
const RECOVER_PATTERN = /\b(UNION\s+ALL|UNION|INTO\s+OUTFILE|LOAD_FILE|BENCHMARK|SLEEP|WAITFOR)\b/i;

@Injectable()
export class ValidateSqlTool {
  asTool() {
    return createTool({
      id: 'validate_sql',
      description:
        'Validate SQL safety before execution. Returns valid | invalid_recoverable | invalid_blocking.',
      inputSchema: z.object({
        actionId: z.string(),
        sql: z.string(),
        dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('postgres'),
      }),
      execute: async (input) => {
        const trimmed = input.sql.trim();
        if (BLOCK_PATTERN.test(trimmed)) {
          return {
            actionId: input.actionId,
            status: 'invalid_blocking' as ValidationStatus,
            reason: 'SQL contains unsafe write/DDL operation',
            safeSql: null,
            riskLevel: 'high' as const,
          };
        }
        if (RECOVER_PATTERN.test(trimmed)) {
          return {
            actionId: input.actionId,
            status: 'invalid_recoverable' as ValidationStatus,
            reason: 'SQL contains potentially risky pattern; regenerate without it',
            safeSql: null,
            riskLevel: 'medium' as const,
          };
        }
        const upper = trimmed.toUpperCase();
        if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
          return {
            actionId: input.actionId,
            status: 'invalid_recoverable' as ValidationStatus,
            reason: `Only SELECT/WITH queries allowed for dialect ${input.dialect}`,
            safeSql: null,
            riskLevel: 'low' as const,
          };
        }
        return {
          actionId: input.actionId,
          status: 'valid' as ValidationStatus,
          reason: 'SQL passed safety validation',
          safeSql: trimmed,
          riskLevel: 'safe' as const,
        };
      },
    });
  }
}
