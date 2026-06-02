/**
 * Typed discriminated union for all agent harness SSE events.
 *
 * These are emitted as sidecar events alongside the standard AI SDK UIMessage
 * stream. The frontend streaming-fetch.ts intercepts and routes them to
 * useAgentHarnessStore; they are stripped before reaching AssistantUI.
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
  'goal_received',
  'step_started',
  'step_completed',
  'agent_iteration',
  'agent_final',
  'agent_error',
]);
