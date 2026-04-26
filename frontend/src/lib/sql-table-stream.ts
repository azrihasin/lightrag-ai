/**
 * Zustand store for streaming SQL table results row by row.
 *
 * The backend emits three SSE event types when execute_sql_agent_tool runs:
 *   sql-table-start  — carries { toolCallId, columns: string[] }
 *   sql-table-row    — carries { toolCallId, row: Record<string, unknown> }
 *   sql-table-end    — carries { toolCallId, rowCount: number }
 *
 * streaming-fetch.ts routes these events here so SqlExecutionBlock can render
 * a shadcn Table that grows row by row in real time without waiting for the
 * full result.
 */
import { create } from "zustand";

export interface SqlTableData {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number | null;
  isComplete: boolean;
}

interface SqlTableStreamStore {
  tables: Record<string, SqlTableData>;
  startTable: (toolCallId: string, columns: string[]) => void;
  addRow: (toolCallId: string, row: Record<string, unknown>) => void;
  endTable: (toolCallId: string, rowCount: number) => void;
}

export const useSqlTableStreamStore = create<SqlTableStreamStore>((set) => ({
  tables: {},

  startTable: (toolCallId, columns) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [toolCallId]: { columns, rows: [], rowCount: null, isComplete: false },
      },
    })),

  addRow: (toolCallId, row) =>
    set((state) => {
      const existing = state.tables[toolCallId];
      if (!existing) return state;
      return {
        tables: {
          ...state.tables,
          [toolCallId]: { ...existing, rows: [...existing.rows, row] },
        },
      };
    }),

  endTable: (toolCallId, rowCount) =>
    set((state) => {
      const existing = state.tables[toolCallId];
      if (!existing) return state;
      return {
        tables: {
          ...state.tables,
          [toolCallId]: { ...existing, rowCount, isComplete: true },
        },
      };
    }),
}));
