import type { MessageDto } from '../dto/chat-request.dto';
import type { UiComponentType } from '../dto/sse-event.dto';

export type ActionType = 'direct_answer' | 'clarification' | 'sql' | 'system_tool' | 'review';
export type ValidationStatus = 'pending' | 'valid' | 'invalid_recoverable' | 'invalid_blocking';
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'error';
export type TerminalStatus = 'complete' | 'clarification_sent' | 'review_needed' | 'max_steps_reached';
export type NextStepType = 'another_query' | 'another_system' | 'human_decision' | 'done';
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high';
export type Strategy = 'direct' | 'sql' | 'system_tool' | 'hybrid' | 'unknown' | 'data_crosscheck' | 'data_passthrough';

export interface Action {
  id: string;
  type: ActionType;
  rationale: string;
  input: Record<string, unknown>;
  validationState: ValidationStatus;
  executionState: ExecutionStatus;
  resultSummary: string | null;
  retryCount: number;
}

export interface ExecutionResult {
  actionId: string;
  success: boolean;
  data: unknown;
  error?: string;
  durationMs: number;
}

export interface ValidationResult {
  actionId: string;
  status: ValidationStatus;
  reason?: string;
}

export interface ResultInspection {
  complete: boolean;
  quality: 'sufficient' | 'partial' | 'failed';
  summary: string;
  dataShape?: Record<string, unknown>;
}

export interface VisualizationPayload {
  componentType: UiComponentType;
  props: Record<string, unknown>;
  patch?: unknown[];
}

export interface RiskState {
  level: RiskLevel;
  reason?: string;
  flaggedAction?: string;
}

export interface ReviewState {
  needed: boolean;
  reason?: string;
  pendingActionId?: string;
}

export interface RetrievedContext {
  documents: unknown[];
  query: string;
  sufficient: boolean;
  contextSummary?: string;
}

export interface AgentState {
  messages: MessageDto[];
  userIntent: string | null;
  strategy: Strategy | null;
  retrievedContext: RetrievedContext | null;
  directAnswerEligible: boolean;
  clarificationNeeded: boolean;
  currentPlan: string | null;
  stepCount: number;
  pendingAction: Action | null;
  actionHistory: Action[];
  validationResults: ValidationResult[];
  executionResults: ExecutionResult[];
  resultInspection: ResultInspection | null;
  nextStepDecision: NextStepType | null;
  visualizationDecision: { suitable: boolean; componentType?: UiComponentType; reason?: string } | null;
  visualizationPayload: VisualizationPayload | null;
  riskState: RiskState | null;
  reviewState: ReviewState | null;
  finalResponseDraft: string | null;
  terminalStatus: TerminalStatus | null;
}

export function createInitialState(messages: MessageDto[]): AgentState {
  return {
    messages,
    userIntent: null,
    strategy: null,
    retrievedContext: null,
    directAnswerEligible: false,
    clarificationNeeded: false,
    currentPlan: null,
    stepCount: 0,
    pendingAction: null,
    actionHistory: [],
    validationResults: [],
    executionResults: [],
    resultInspection: null,
    nextStepDecision: null,
    visualizationDecision: null,
    visualizationPayload: null,
    riskState: null,
    reviewState: null,
    finalResponseDraft: null,
    terminalStatus: null,
  };
}
