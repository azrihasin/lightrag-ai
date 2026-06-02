/**
 * Typed discriminated union for all agent harness SSE events — frontend mirror.
 * Keep in sync with minds-ai-agent/src/shared/agent-events.types.ts.
 */

export interface GoalReceivedEvent {
  type: 'goal_received';
  goal: string;
  sessionId: string;
  ts: number;
}

export interface StepStartedEvent {
  type: 'step_started';
  stepId: string;
  agentName: string;
  ts: number;
}

export interface StepCompletedEvent {
  type: 'step_completed';
  stepId: string;
  agentName: string;
  durationMs: number;
  ts: number;
}

export interface AgentIterationEvent {
  type: 'agent_iteration';
  iteration: number;
  ts: number;
}

export interface AgentFinalEvent {
  type: 'agent_final';
  totalIterations: number;
  totalToolCalls: number;
  durationMs: number;
  ts: number;
}

export interface AgentHarnessErrorEvent {
  type: 'agent_error';
  message: string;
  retryable: boolean;
  ts: number;
}

export type AgentHarnessEvent =
  | GoalReceivedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | AgentIterationEvent
  | AgentFinalEvent
  | AgentHarnessErrorEvent;

export const AGENT_HARNESS_EVENT_TYPES = new Set<string>([
  // Legacy supervisor-path events (MindsAgentService)
  'goal_received',
  'step_started',
  'step_completed',
  'agent_iteration',
  'agent_final',
  'agent_error',
  // DataAgentHarness events are wrapped in {type:'data-harness',data:event,transient:true}
  // so they pass uiMessageChunkSchema. We intercept the outer 'data-harness' type here.
  'data-harness',
]);
