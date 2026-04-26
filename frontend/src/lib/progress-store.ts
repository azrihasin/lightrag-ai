/**
 * Zustand store for agent execution progress events.
 *
 * The custom fetch interceptor (streaming-fetch.ts) routes backend `progress`
 * SSE events here as they arrive.  AgentTimeline reads from this store to
 * render the live execution trace inside the currently-streaming message.
 *
 * Lifecycle:
 *   startSession()  — called when the `start` SSE event fires
 *   addEvent()      — called for each `progress` SSE event
 *   finishSession() — called when the `finish` SSE event fires
 */
import { create } from "zustand";

export type ProgressStatus = "running" | "complete" | "error";

export interface ProgressEvent {
  phase: string;
  step: string;
  status: ProgressStatus;
  message: string;
  detail?: string;
  /** Set on substep events (step === "substep") to identify the individual sub-operation. */
  substepId?: string;
  ts: number;
}

/** Maps a raw phase id to a display label. */
export const PHASE_LABELS: Record<string, string> = {
  "data-gathering": "Data Gathering",
  "ui-retrieval": "UI Discovery",
  "patch-generation": "Patch Generation",
  response: "Response",
};

interface ProgressStore {
  /** True while the SSE stream is active (between `start` and `finish`). */
  isActive: boolean;
  /** Events for the current (or most recently completed) streaming session. */
  events: ProgressEvent[];

  startSession: () => void;
  addEvent: (event: Omit<ProgressEvent, "ts">) => void;
  finishSession: () => void;
}

export const useProgressStore = create<ProgressStore>((set) => ({
  isActive: false,
  events: [],

  startSession: () =>
    set({ isActive: true, events: [] }),

  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, { ...event, ts: Date.now() }],
    })),

  finishSession: () =>
    set({ isActive: false }),
}));
