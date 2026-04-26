/**
 * Zustand store for streaming pre/post tool annotation text.
 *
 * The custom fetch interceptor (streaming-fetch.ts) routes:
 *  - pre-tool-text-delta  → appended to preText[toolCallId]  (LLM explains why it's calling the tool)
 *  - post-tool-text-delta → appended to postText[toolCallId] (LLM summarizes the result)
 *
 * ToolFallback reads from this store to show streaming annotations inside the tool div.
 */
import { create } from "zustand";

interface ToolAnnotationStore {
  preText: Record<string, string>;
  postText: Record<string, string>;
  preComplete: Record<string, boolean>;
  postComplete: Record<string, boolean>;
  appendPreDelta: (toolCallId: string, delta: string) => void;
  appendPostDelta: (toolCallId: string, delta: string) => void;
  setPreComplete: (toolCallId: string) => void;
  setPostComplete: (toolCallId: string) => void;
}

export const useToolAnnotationStore = create<ToolAnnotationStore>((set) => ({
  preText: {},
  postText: {},
  preComplete: {},
  postComplete: {},
  appendPreDelta: (toolCallId, delta) =>
    set((state) => ({
      preText: {
        ...state.preText,
        [toolCallId]: (state.preText[toolCallId] ?? "") + delta,
      },
    })),
  appendPostDelta: (toolCallId, delta) =>
    set((state) => ({
      postText: {
        ...state.postText,
        [toolCallId]: (state.postText[toolCallId] ?? "") + delta,
      },
    })),
  setPreComplete: (toolCallId) =>
    set((state) => ({
      preComplete: { ...state.preComplete, [toolCallId]: true },
    })),
  setPostComplete: (toolCallId) =>
    set((state) => ({
      postComplete: { ...state.postComplete, [toolCallId]: true },
    })),
}));
