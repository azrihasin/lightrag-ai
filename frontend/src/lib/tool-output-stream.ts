/**
 * Zustand store for streaming tool output deltas.
 *
 * The custom fetch interceptor (streaming-fetch.ts) appends deltas here as
 * they arrive from SSE tool-output-delta events. Components read from this
 * store while a tool is still running, then switch to the final `result` prop
 * once tool-output-available fires and the AI SDK runtime sets the result.
 */
import { create } from "zustand";

interface ToolOutputStreamStore {
  partials: Record<string, string>;
  appendDelta: (toolCallId: string, delta: string) => void;
}

export const useToolOutputStreamStore = create<ToolOutputStreamStore>((set) => ({
  partials: {},
  appendDelta: (toolCallId, delta) =>
    set((state) => ({
      partials: {
        ...state.partials,
        [toolCallId]: (state.partials[toolCallId] ?? "") + delta,
      },
    })),
}));
