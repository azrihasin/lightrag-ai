import { create } from "zustand";

interface SqlGeneratedEntry {
  sql: string;
  dialect: string;
}

interface SqlGeneratedStore {
  queries: Record<string, SqlGeneratedEntry>;
  setQuery: (toolCallId: string, sql: string, dialect: string) => void;
}

export const useSqlGeneratedStore = create<SqlGeneratedStore>((set) => ({
  queries: {},
  setQuery: (toolCallId, sql, dialect) =>
    set((s) => ({
      queries: { ...s.queries, [toolCallId]: { sql, dialect } },
    })),
}));
