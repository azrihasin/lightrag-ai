import { create } from "zustand";

interface JmespathEntry {
  query: string;
  component: string;
}

interface JmespathStore {
  entries: Record<string, JmespathEntry>;
  setEntry: (toolCallId: string, query: string, component: string) => void;
}

export const useJmespathStore = create<JmespathStore>((set) => ({
  entries: {},
  setEntry: (toolCallId, query, component) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [toolCallId]: { query, component },
      },
    })),
}));
