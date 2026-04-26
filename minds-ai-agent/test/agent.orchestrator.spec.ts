/**
 * Focused unit tests for the agent pipeline branches.
 *
 * Each test stubs only what is needed to exercise one branch.
 * Tool execute() functions are called directly — no LLM required.
 */

import { RetrieveContextTool } from '../src/chat/tools/retrieve-context.tool';
import { AnswerFromContextTool } from '../src/chat/tools/answer-from-context.tool';
import { ClarificationRequestTool } from '../src/chat/tools/clarification-request.tool';
import { GenerateSqlTool } from '../src/chat/tools/generate-sql.tool';
import { ValidateSqlTool } from '../src/chat/tools/validate-sql.tool';
import { ExecuteSqlTool } from '../src/chat/tools/execute-sql.tool';
import { GenerateActionTool } from '../src/chat/tools/generate-action.tool';
import { ValidateActionTool } from '../src/chat/tools/validate-action.tool';
import { ExecuteSystemActionTool } from '../src/chat/tools/execute-system-action.tool';
import { InspectResultTool } from '../src/chat/tools/inspect-result.tool';
import { PrepareVisualizationTool } from '../src/chat/tools/prepare-visualization.tool';
import { RenderVisualizationTool } from '../src/chat/tools/render-visualization.tool';
import { HumanReviewGateTool } from '../src/chat/tools/human-review-gate.tool';
import { SummarizeResultTool } from '../src/chat/tools/summarize-result.tool';
import { createInitialState } from '../src/chat/agent/agent.state';

// ── helpers ────────────────────────────────────────────────────────────────

function msg(content: string) {
  return { id: '1', role: 'user' as const, content, parts: [{ type: 'text' as const, text: content }], createdAt: undefined };
}

// ── A. Direct-answer from context ──────────────────────────────────────────

describe('retrieve_context → answer_from_context (direct answer branch)', () => {
  const retrieveTool = new RetrieveContextTool();
  const answerTool = new AnswerFromContextTool();

  it('retrieve_context returns sufficient=true when ≥2 docs', async () => {
    const fn = retrieveTool.asTool().execute as Function;
    const result = await fn({ query: 'What is NestJS?', mode: 'hybrid', maxDocuments: 5 });
    expect(result.sufficient).toBe(true);
    expect(result.documents.length).toBeGreaterThanOrEqual(2);
    expect(result.query).toBe('What is NestJS?');
  });

  it('retrieve_context returns sufficient=false when maxDocuments=1', async () => {
    const fn = retrieveTool.asTool().execute as Function;
    const result = await fn({ query: 'obscure query', mode: 'keyword', maxDocuments: 1 });
    expect(result.sufficient).toBe(false);
  });

  it('answer_from_context marks answer as sourced from lightrag', async () => {
    const fn = answerTool.asTool().execute as Function;
    const result = await fn({
      question: 'What is NestJS?',
      context: 'NestJS is a Node.js framework.',
      answerText: 'NestJS is a progressive Node.js framework.',
      citations: ['doc-1'],
    });
    expect(result.answered).toBe(true);
    expect(result.source).toBe('lightrag_context');
    expect(result.answer).toBe('NestJS is a progressive Node.js framework.');
    expect(result.citations).toEqual(['doc-1']);
  });
});

// ── B. Clarification branch ────────────────────────────────────────────────

describe('clarification_request branch', () => {
  const tool = new ClarificationRequestTool();

  it('returns clarificationRequested=true with question and suggestions', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      question: 'Which table would you like to query?',
      reason: 'Multiple tables match the description',
      suggestions: ['orders', 'customers'],
    });
    expect(result.clarificationRequested).toBe(true);
    expect(result.question).toBe('Which table would you like to query?');
    expect(result.suggestions).toEqual(['orders', 'customers']);
  });
});

// ── C. SQL validation / regeneration / execution ───────────────────────────

describe('generate_sql → validate_sql → execute_sql', () => {
  const genTool = new GenerateSqlTool();
  const valTool = new ValidateSqlTool();
  const execTool = new ExecuteSqlTool();

  it('generate_sql produces actionId and requiresValidation flag', async () => {
    const fn = genTool.asTool().execute as Function;
    const result = await fn({ intent: 'show all users', dialect: 'postgres' });
    expect(result.actionId).toBeDefined();
    expect(result.sql).toMatch(/SELECT/i);
    expect(result.requiresValidation).toBe(true);
  });

  it('validate_sql passes a safe SELECT query', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      sql: 'SELECT id, name FROM users LIMIT 10',
      dialect: 'postgres',
    });
    expect(result.status).toBe('valid');
    expect(result.safeSql).toBeTruthy();
    expect(result.riskLevel).toBe('safe');
  });

  it('validate_sql blocks INSERT statement', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      sql: 'INSERT INTO users (name) VALUES (\'evil\')',
      dialect: 'postgres',
    });
    expect(result.status).toBe('invalid_blocking');
    expect(result.riskLevel).toBe('high');
    expect(result.safeSql).toBeNull();
  });

  it('validate_sql returns invalid_recoverable for non-SELECT query', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      sql: 'SHOW TABLES',
      dialect: 'mysql',
    });
    expect(result.status).toBe('invalid_recoverable');
    expect(result.safeSql).toBeNull();
  });

  it('validate_sql marks UNION as invalid_recoverable (medium risk)', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      sql: "SELECT 1 UNION SELECT password FROM users",
      dialect: 'postgres',
    });
    expect(result.status).toBe('invalid_recoverable');
    expect(result.riskLevel).toBe('medium');
  });

  it('execute_sql returns rows and columns', async () => {
    const fn = execTool.asTool().execute as Function;
    const result = await fn({ actionId: 'test-id', sql: 'SELECT * FROM users' });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.columns).toContain('id');
    expect(result.columns).toContain('name');
  });
});

// ── D. System action path ──────────────────────────────────────────────────

describe('generate_action → validate_action → execute_system_action', () => {
  const genTool = new GenerateActionTool();
  const valTool = new ValidateActionTool();
  const execTool = new ExecuteSystemActionTool();

  it('generate_action produces actionId with type system_tool', async () => {
    const fn = genTool.asTool().execute as Function;
    const result = await fn({
      intent: 'calculate 2 + 2',
      system: 'calculator',
      params: { expression: '2 + 2' },
    });
    expect(result.actionId).toBeDefined();
    expect(result.type).toBe('system_tool');
    expect(result.toolName).toBe('calculator');
    expect(result.requiresValidation).toBe(true);
  });

  it('validate_action passes valid calculator input', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'calculator',
      input: { expression: '2 + 2' },
    });
    expect(result.status).toBe('valid');
  });

  it('validate_action returns invalid_recoverable for missing required field', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'calculator',
      input: { /* missing expression */ },
    });
    expect(result.status).toBe('invalid_recoverable');
  });

  it('validate_action blocks unknown tool', async () => {
    const fn = valTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'unknown_system',
      input: {},
    });
    expect(result.status).toBe('invalid_blocking');
  });

  it('execute_system_action runs calculator', async () => {
    const fn = execTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'calculator',
      input: { expression: '10 * 5' },
    });
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).result).toBe(50);
  });

  it('execute_system_action runs generic_search', async () => {
    const fn = execTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'generic_search',
      input: { query: 'NestJS tutorial', maxResults: 3 },
    });
    expect(result.success).toBe(true);
    const inner = result.result as Record<string, unknown>;
    expect(Array.isArray(inner.results)).toBe(true);
    expect((inner.results as unknown[]).length).toBe(3);
  });

  it('execute_system_action generates synthetic data rows', async () => {
    const fn = execTool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      toolName: 'synthetic_data',
      input: {
        entityName: 'Product',
        fields: [
          { name: 'price', type: 'number', min: 10, max: 100 },
          { name: 'category', type: 'enum', enumValues: ['A', 'B'] },
        ],
        rowCount: 5,
        seed: 42,
      },
    });
    expect(result.success).toBe(true);
    const inner = result.result as Record<string, unknown>;
    expect((inner.rows as unknown[]).length).toBe(5);
  });
});

// ── E. Incomplete-result looping (inspect_result) ─────────────────────────

describe('inspect_result — complete vs partial', () => {
  const tool = new InspectResultTool();

  it('marks complete=true for results with rows', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      result: { rows: [{ id: 1, name: 'Alice' }], columns: ['id', 'name'] },
      intent: 'get users',
    });
    expect(result.complete).toBe(true);
    expect(result.quality).toBe('sufficient');
  });

  it('marks complete=false for empty rows', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      result: { rows: [], columns: ['id'] },
      intent: 'get users',
    });
    expect(result.complete).toBe(false);
    expect(result.quality).toBe('partial');
  });

  it('marks quality=failed on error result', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      result: { error: 'Connection timeout' },
      intent: 'get users',
    });
    expect(result.quality).toBe('failed');
    expect(result.complete).toBe(false);
  });

  it('extracts dataShape with hasNumericCols', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      actionId: 'test-id',
      result: {
        rows: [{ id: 1, value: 42 }],
        columns: ['id', 'value'],
      },
      intent: 'get metrics',
    });
    expect((result.dataShape as Record<string, unknown>)?.hasNumericCols).toBe(true);
  });
});

// ── F. Visualization branch ────────────────────────────────────────────────

describe('prepare_visualization_data → render_visualization', () => {
  const prepTool = new PrepareVisualizationTool();
  const renderTool = new RenderVisualizationTool();

  it('selects chart for numeric rows > 3', async () => {
    const fn = prepTool.asTool().execute as Function;
    const rows = [1, 2, 3, 4].map((i) => ({ id: i, value: i * 10 }));
    const result = await fn({
      result: { rows, columns: ['id', 'value'] },
      dataShape: { hasNumericCols: true, numericCols: ['value'], columns: ['id', 'value'] },
    });
    expect(result.suitable).toBe(true);
    expect(result.componentType).toBe('chart');
    expect((result.props as Record<string, unknown>).yKeys).toEqual(['value']);
  });

  it('selects table for non-numeric rows', async () => {
    const fn = prepTool.asTool().execute as Function;
    const rows = [{ id: 1, name: 'Alice' }];
    const result = await fn({
      result: { rows, columns: ['id', 'name'] },
      dataShape: { hasNumericCols: false, numericCols: [], columns: ['id', 'name'] },
    });
    expect(result.suitable).toBe(true);
    expect(result.componentType).toBe('table');
  });

  it('selects metric-card for scalar result', async () => {
    const fn = prepTool.asTool().execute as Function;
    const result = await fn({
      result: { result: 42, expression: '6 * 7' },
    });
    expect(result.suitable).toBe(true);
    expect(result.componentType).toBe('metric-card');
    expect((result.props as Record<string, unknown>).value).toBe(42);
  });

  it('returns suitable=false for empty result', async () => {
    const fn = prepTool.asTool().execute as Function;
    const result = await fn({ result: {} });
    expect(result.suitable).toBe(false);
  });

  it('render_visualization wraps props into dataSpec', async () => {
    const fn = renderTool.asTool().execute as Function;
    const result = await fn({
      componentType: 'chart',
      props: { chartType: 'bar', data: [], xKey: 'id', yKeys: ['value'] },
    });
    expect(result.rendered).toBe(true);
    expect(result.dataSpec.componentType).toBe('chart');
    expect((result.dataSpec.props as Record<string, unknown>).chartType).toBe('bar');
  });
});

// ── G. Risk / review branch ────────────────────────────────────────────────

describe('human_review_gate (risky/unsafe branch)', () => {
  const tool = new HumanReviewGateTool();

  it('sets reviewNeeded=true with riskLevel and reason', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      reason: 'SQL attempts to read sensitive data',
      actionId: 'action-abc',
      riskLevel: 'high',
    });
    expect(result.reviewNeeded).toBe(true);
    expect(result.riskLevel).toBe('high');
    expect(result.actionId).toBe('action-abc');
  });

  it('provides a default safe fallback message', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({
      reason: 'Potentially risky operation',
      riskLevel: 'medium',
    });
    expect(result.suggestedResponse).toBeTruthy();
  });
});

// ── H. AgentState initialization ──────────────────────────────────────────

describe('createInitialState', () => {
  it('creates state with all fields null/empty', () => {
    const state = createInitialState([msg('hello')]);
    expect(state.userIntent).toBeNull();
    expect(state.strategy).toBeNull();
    expect(state.retrievedContext).toBeNull();
    expect(state.directAnswerEligible).toBe(false);
    expect(state.clarificationNeeded).toBe(false);
    expect(state.stepCount).toBe(0);
    expect(state.actionHistory).toEqual([]);
    expect(state.terminalStatus).toBeNull();
  });

  it('preserves messages', () => {
    const messages = [msg('test query')];
    const state = createInitialState(messages);
    expect(state.messages).toBe(messages);
  });
});

// ── I. SummarizeResult ────────────────────────────────────────────────────

describe('summarize_result', () => {
  const tool = new SummarizeResultTool();

  it('summarizes row results with preview', async () => {
    const fn = tool.asTool().execute as Function;
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
    const result = await fn({ result: { rows }, intent: 'list users' });
    expect(result.summary).toContain('5 result');
    expect(result.summary).toContain('Row 1');
  });

  it('summarizes scalar answer', async () => {
    const fn = tool.asTool().execute as Function;
    const result = await fn({ result: { answer: 'Paris is the capital of France.' }, intent: 'capital city' });
    expect(result.summary).toBe('Paris is the capital of France.');
  });
});
