import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ValidationStatus } from '../agent/agent.state';

const BLOCK_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|xp_|sp_)\b/i;
const RECOVER_PATTERN = /\b(UNION\s+ALL|UNION|INTO\s+OUTFILE|LOAD_FILE|BENCHMARK|SLEEP|WAITFOR)\b/i;

@Injectable()
export class ValidateSqlTool {
  asTool() {
    return tool(
      async ({ actionId, sql, dialect }): Promise<{
        actionId: string;
        status: ValidationStatus;
        reason: string;
        safeSql: string | null;
        riskLevel: 'safe' | 'low' | 'medium' | 'high';
      }> => {
        const trimmed = sql.trim();
        if (BLOCK_PATTERN.test(trimmed)) {
          return {
            actionId,
            status: 'invalid_blocking',
            reason: 'SQL contains unsafe write/DDL operation',
            safeSql: null,
            riskLevel: 'high',
          };
        }
        if (RECOVER_PATTERN.test(trimmed)) {
          return {
            actionId,
            status: 'invalid_recoverable',
            reason: 'SQL contains potentially risky pattern; regenerate without it',
            safeSql: null,
            riskLevel: 'medium',
          };
        }
        const upper = trimmed.toUpperCase();
        if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
          return {
            actionId,
            status: 'invalid_recoverable',
            reason: `Only SELECT/WITH queries allowed for dialect ${dialect}`,
            safeSql: null,
            riskLevel: 'low',
          };
        }
        return {
          actionId,
          status: 'valid',
          reason: 'SQL passed safety validation',
          safeSql: trimmed,
          riskLevel: 'safe',
        };
      },
      {
        name: 'validate_sql',
        description:
          'Validate SQL safety and dialect compliance before execution. ' +
          'Returns valid | invalid_recoverable | invalid_blocking. Must be called before execute_sql.',
        schema: z.object({
          actionId: z.string(),
          sql: z.string(),
          dialect: z.enum(['postgres', 'mysql', 'sqlite', 'mssql']).optional().default('postgres'),
        }),
      },
    );
  }
}
