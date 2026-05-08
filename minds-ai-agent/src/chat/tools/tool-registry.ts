import { Injectable } from '@nestjs/common';
import { RetrieveContextTool } from './retrieve-context.tool';
import { AnswerFromContextTool } from './answer-from-context.tool';
import { ClarificationRequestTool } from './clarification-request.tool';
import { SearchTool } from './search.tool';
import { GenerateSqlTool } from './generate-sql.tool';
import { ValidateSqlTool } from './validate-sql.tool';
import { ExecuteSqlTool } from './execute-sql.tool';
import { GenerateActionTool } from './generate-action.tool';
import { ValidateActionTool } from './validate-action.tool';
import { ExecuteSystemActionTool } from './execute-system-action.tool';
import { PrepareVisualizationTool } from './prepare-visualization.tool';
import { RenderVisualizationTool } from './render-visualization.tool';
import { HumanReviewGateTool } from './human-review-gate.tool';
import { SummarizeResultTool } from './summarize-result.tool';
import { ComposeResponseTool } from './compose-response.tool';
import { CalculatorTool } from './calculator.tool';

export interface ToolResult {
  toolName: string;
  toolCallId: string;
  output: unknown;
  sanitized: boolean;
  durationMs: number;
}

@Injectable()
export class ToolRegistry {
  constructor(
    private readonly retrieveContext: RetrieveContextTool,
    private readonly answerFromContext: AnswerFromContextTool,
    private readonly clarificationRequest: ClarificationRequestTool,
    private readonly genericSearch: SearchTool,
    private readonly generateSql: GenerateSqlTool,
    private readonly validateSql: ValidateSqlTool,
    private readonly executeSql: ExecuteSqlTool,
    private readonly generateAction: GenerateActionTool,
    private readonly validateAction: ValidateActionTool,
    private readonly executeSystemAction: ExecuteSystemActionTool,
    private readonly prepareVisualization: PrepareVisualizationTool,
    private readonly renderVisualization: RenderVisualizationTool,
    private readonly humanReviewGate: HumanReviewGateTool,
    private readonly summarizeResult: SummarizeResultTool,
    private readonly composeResponse: ComposeResponseTool,
    private readonly calculator: CalculatorTool,
  ) {}

  getAll() {
    return {
      retrieve_context:         this.retrieveContext.asTool(),
      answer_from_context:      this.answerFromContext.asTool(),
      clarification_request:    this.clarificationRequest.asTool(),
      generic_search:           this.genericSearch.asTool(),
      generate_sql:             this.generateSql.asTool(),
      validate_sql:             this.validateSql.asTool(),
      execute_sql:              this.executeSql.asTool(),
      generate_action:          this.generateAction.asTool(),
      validate_action:          this.validateAction.asTool(),
      execute_system_action:    this.executeSystemAction.asTool(),
      prepare_visualization_data: this.prepareVisualization.asTool(),
      render_visualization:     this.renderVisualization.asTool(),
      human_review_gate:        this.humanReviewGate.asTool(),
      summarize_result:         this.summarizeResult.asTool(),
      compose_final_response:   this.composeResponse.asTool(),
      calculator:               this.calculator.asTool(),
    };
  }

  asList() {
    return Object.values(this.getAll());
  }

  sanitize(raw: unknown): unknown {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') return raw.slice(0, 8000);
    if (Array.isArray(raw)) return raw.slice(0, 200).map((item) => this.sanitize(item));
    if (typeof raw === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!/password|secret|token|key/i.test(k)) cleaned[k] = this.sanitize(v);
      }
      return cleaned;
    }
    return raw;
  }
}
