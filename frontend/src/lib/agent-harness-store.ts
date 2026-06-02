/**
 * Zustand store for the agent goal-solving harness.
 *
 * Populated by streaming-fetch.ts as SSE harness events arrive.
 * Read by AgentGoalHeader to render a Claude Code-style live progress panel.
 *
 * Lifecycle:
 *   setGoal()        — on `goal_received` event
 *   startStep()      — on `step_started` event
 *   completeStep()   — on `step_completed` event
 *   setIteration()   — on `agent_iteration` event
 *   finish()         — on `agent_final` event
 *   setError()       — on `agent_error` event
 *   reset()          — on next `goal_received` (new request)
 */
import { create } from 'zustand';

export type StepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface AgentStep {
  stepId: string;
  agentName: string;
  status: StepStatus;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  textDelta?: string;
}

export type HarnessStatus = 'idle' | 'running' | 'complete' | 'error';

interface AgentHarnessStore {
  status: HarnessStatus;
  goal: string;
  sessionId: string;
  currentIteration: number;
  steps: AgentStep[];
  totalToolCalls: number;
  totalDurationMs: number;
  errorMessage: string | null;

  setGoal: (goal: string, sessionId: string) => void;
  startStep: (stepId: string, agentName: string) => void;
  completeStep: (stepId: string, durationMs: number) => void;
  appendStepText: (stepId: string, text: string) => void;
  setIteration: (iteration: number) => void;
  finish: (totalIterations: number, totalToolCalls: number, durationMs: number) => void;
  setError: (message: string) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  status: 'idle' as HarnessStatus,
  goal: '',
  sessionId: '',
  currentIteration: 0,
  steps: [] as AgentStep[],
  totalToolCalls: 0,
  totalDurationMs: 0,
  errorMessage: null as string | null,
};

export const useAgentHarnessStore = create<AgentHarnessStore>((set) => ({
  ...INITIAL_STATE,

  setGoal: (goal, sessionId) =>
    set({
      ...INITIAL_STATE,
      status: 'running',
      goal,
      sessionId,
    }),

  startStep: (stepId, agentName) =>
    set((state) => {
      // Avoid duplicate steps for the same stepId (idempotent)
      if (state.steps.some((s) => s.stepId === stepId && s.status === 'running')) {
        return state;
      }
      const step: AgentStep = {
        stepId,
        agentName,
        status: 'running',
        startTs: Date.now(),
      };
      return { steps: [...state.steps, step] };
    }),

  completeStep: (stepId, durationMs) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.stepId === stepId && s.status === 'running'
          ? { ...s, status: 'complete', endTs: Date.now(), durationMs }
          : s,
      ),
    })),

  appendStepText: (stepId, text) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.stepId === stepId && s.status === 'running'
          ? { ...s, textDelta: text }
          : s,
      ),
    })),

  setIteration: (iteration) =>
    set({ currentIteration: iteration }),

  finish: (totalIterations, totalToolCalls, durationMs) =>
    set((state) => ({
      status: 'complete',
      currentIteration: totalIterations,
      totalToolCalls,
      totalDurationMs: durationMs,
      // Mark any still-running steps as complete
      steps: state.steps.map((s) =>
        s.status === 'running' ? { ...s, status: 'complete', endTs: Date.now() } : s,
      ),
    })),

  setError: (message) =>
    set((state) => ({
      status: 'error',
      errorMessage: message,
      steps: state.steps.map((s) =>
        s.status === 'running' ? { ...s, status: 'error', endTs: Date.now() } : s,
      ),
    })),

  reset: () => set(INITIAL_STATE),
}));
