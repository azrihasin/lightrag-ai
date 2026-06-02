import { Injectable } from '@nestjs/common';

export type SqlValidationResult = {
  valid: boolean;
  normalizedSql?: string;
  readOnly: boolean;
  reasons: string[];
};

// Patterns that unconditionally block execution
const BLOCK_PATTERNS: RegExp[] = [
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i,
  /\b(GRANT|REVOKE|EXEC|EXECUTE|CALL|xp_|sp_)\b/i,
  /\bINTO\s+OUTFILE\b/i,
  /\bLOAD_FILE\s*\(/i,
  /\bLOAD\s+DATA\b/i,
  /\bSHUTDOWN\b/i,
  /\bSLEEP\s*\(/i,
  /\bBENCHMARK\s*\(/i,
  /\bWAITFOR\b/i,
];

// Patterns for SQL comment injection that could hide extra statements
const COMMENT_INJECTION_PATTERNS: RegExp[] = [
  /\/\*.*?\*\//s,  // block comments
  /--[^\r\n]*/,    // line comments
  /#[^\r\n]*/,     // hash comments (MySQL/MariaDB)
];

// Aggregate functions that indicate no row limit needed
const AGGREGATE_FUNCTIONS = /\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT)\s*\(/i;

const DEFAULT_LIMIT = 200;

@Injectable()
export class SqlSafetyService {
  validate(rawSql: string): SqlValidationResult {
    if (!rawSql || typeof rawSql !== 'string') {
      return { valid: false, readOnly: false, reasons: ['Empty or non-string SQL input'] };
    }

    // Remove comments first (but track if injection is attempted)
    const commentMatch = COMMENT_INJECTION_PATTERNS.some(p => p.test(rawSql));
    const stripped = this.stripComments(rawSql).trim();

    if (!stripped) {
      return { valid: false, readOnly: false, reasons: ['SQL is empty after stripping comments'] };
    }

    // Multi-statement detection (semicolon not at end)
    const withoutStrings = this.removeStringLiterals(stripped);
    const stmts = withoutStrings.split(';').map(s => s.trim()).filter(Boolean);
    if (stmts.length > 1) {
      return { valid: false, readOnly: false, reasons: ['Multi-statement SQL is not allowed'] };
    }

    const reasons: string[] = [];

    if (commentMatch) {
      reasons.push('SQL contains comments — stripped for safety');
    }

    // Block patterns
    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.test(stripped)) {
        return {
          valid: false,
          readOnly: false,
          reasons: [`SQL contains forbidden pattern: ${pattern.toString()}`],
        };
      }
    }

    // Must start with SELECT or WITH (read-only)
    const upper = stripped.toUpperCase().replace(/\s+/g, ' ');
    if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
      return {
        valid: false,
        readOnly: false,
        reasons: ['Only SELECT or read-only WITH queries are allowed'],
      };
    }

    // LIMIT enforcement: add default limit for non-aggregate queries
    let normalizedSql = stripped;
    const hasLimit = /\bLIMIT\s+\d+/i.test(stripped);
    const isAggregate = AGGREGATE_FUNCTIONS.test(stripped) && !/\bGROUP\s+BY\b/i.test(stripped) === false;

    if (!hasLimit && !isAggregate) {
      normalizedSql = `${stripped.replace(/;?\s*$/, '')} LIMIT ${DEFAULT_LIMIT}`;
      reasons.push(`Auto-added LIMIT ${DEFAULT_LIMIT} to detail query`);
    }

    return {
      valid: true,
      normalizedSql,
      readOnly: true,
      reasons,
    };
  }

  private stripComments(sql: string): string {
    // Remove block comments
    let result = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Remove line comments
    result = result.replace(/--[^\r\n]*/g, ' ');
    // Remove hash comments
    result = result.replace(/#[^\r\n]*/g, ' ');
    return result;
  }

  private removeStringLiterals(sql: string): string {
    // Replace quoted strings to avoid false semicolon splits
    return sql
      .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
      .replace(/"(?:[^"\\]|\\.)*"/g, '"?"');
  }
}
