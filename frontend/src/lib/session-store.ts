import { create } from "zustand";
import { chatHistoryApi, type ChatSession, type ChatMessage } from "./chat-history-api";

export interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: ChatMessage[];
  loading: boolean;
  error: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<ChatMessage[]>;
  createSession: () => Promise<string>;
  renameSession: (id: string, title: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  setActiveSessionId: (id: string | null) => void;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeMessages: [],
  loading: false,
  error: null,

  async loadSessions() {
    set({ loading: true, error: null });
    try {
      const sessions = await chatHistoryApi.listSessions({ limit: 100 });
      set({ sessions, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  async selectSession(id: string) {
    set({ loading: true, error: null });
    try {
      const session = await chatHistoryApi.getSession(id);
      const { sessions } = get();
      const exists = sessions.find((s) => s.id === id);
      if (!exists) {
        set({ sessions: [session, ...sessions] });
      }
      set({ activeSessionId: id, activeMessages: session.messages, loading: false });
      return session.messages;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      return [];
    }
  },

  async createSession() {
    const session = await chatHistoryApi.createSession();
    set((state) => ({ sessions: [session, ...state.sessions], activeSessionId: session.id, activeMessages: [] }));
    return session.id;
  },

  async renameSession(id: string, title: string) {
    await chatHistoryApi.updateSession(id, { title });
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
    }));
  },

  async archiveSession(id: string) {
    await chatHistoryApi.archiveSession(id);
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const activeSessionId = state.activeSessionId === id ? (sessions[0]?.id ?? null) : state.activeSessionId;
      return { sessions, activeSessionId };
    });
  },

  setActiveSessionId(id: string | null) {
    set({ activeSessionId: id });
  },

  clearError() {
    set({ error: null });
  },
}));
