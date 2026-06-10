const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/chat").replace(
  /\/chat$/,
  "/chat-history",
);

const CHAT_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api/chat";

// ─── Legacy session types (existing /api/chat-history endpoints) ──────────────

export interface ChatSession {
  id: string;
  user_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  parent_message_id: string | null;
  sequence_index: number;
  role: "user" | "assistant" | "system" | "agent" | "tool" | "thinking";
  message_type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  tool_payload: Record<string, unknown> | null;
  thinking_payload: Record<string, unknown> | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

// ─── Mastra thread types (new /api/chat/threads endpoints) ───────────────────

export interface MastraThread {
  id: string;
  resourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface MastraMessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolInvocation?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MastraMessage {
  id: string;
  threadId: string;
  resourceId?: string;
  role: "user" | "assistant" | "system" | "signal";
  type: string;
  createdAt: string;
  parts: MastraMessagePart[];
  metadata?: Record<string, unknown>;
}

/** Visualization payload re-hydrated by the rerun endpoint. */
export interface RerunVisualizationSpec {
  componentType: string;
  props: Record<string, unknown>;
}

/** Fresh result returned by POST /api/chat/rerun. */
export interface RerunResult {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  spec?: RerunVisualizationSpec;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`chat-history API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function chatRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CHAT_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`chat API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Legacy session API (kept for backward compat) ───────────────────────────

export const chatHistoryApi = {
  createSession(params?: { user_id?: string; title?: string; metadata?: Record<string, unknown> }) {
    return request<ChatSession>("/sessions", {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  },

  listSessions(opts?: { user_id?: string; limit?: number; offset?: number; include_archived?: boolean }) {
    const qs = new URLSearchParams();
    if (opts?.user_id) qs.set("user_id", opts.user_id);
    if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts?.include_archived) qs.set("include_archived", "true");
    const q = qs.toString();
    return request<ChatSession[]>(`/sessions${q ? `?${q}` : ""}`);
  },

  getSession(id: string) {
    return request<SessionWithMessages>(`/sessions/${encodeURIComponent(id)}`);
  },

  updateSession(id: string, patch: { title?: string; metadata?: Record<string, unknown> }) {
    return request<void>(`/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  archiveSession(id: string) {
    return request<void>(`/sessions/${encodeURIComponent(id)}/archive`, { method: "POST" });
  },
};

// ─── Mastra thread API ────────────────────────────────────────────────────────

export const mastraThreadApi = {
  listThreads(resourceId: string, limit = 50): Promise<MastraThread[]> {
    const qs = new URLSearchParams({ resourceId, limit: String(limit) });
    return chatRequest<MastraThread[]>(`/threads?${qs}`);
  },

  getThreadMessages(threadId: string, resourceId: string): Promise<MastraMessage[]> {
    const qs = new URLSearchParams({ resourceId });
    return chatRequest<MastraMessage[]>(`/threads/${encodeURIComponent(threadId)}/messages?${qs}`);
  },

  rerunMessage(threadId: string, messageId: string, resourceId: string): Promise<RerunResult> {
    return chatRequest<RerunResult>("/rerun", {
      method: "POST",
      body: JSON.stringify({ threadId, messageId, resourceId }),
    });
  },

  deleteThread(threadId: string, resourceId: string): Promise<void> {
    const qs = new URLSearchParams({ resourceId });
    return chatRequest<void>(`/threads/${encodeURIComponent(threadId)}?${qs}`, {
      method: "DELETE",
    });
  },
};
