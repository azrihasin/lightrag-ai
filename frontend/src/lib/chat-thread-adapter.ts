import type {
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatRepository,
} from "@assistant-ui/react";
import type { RemoteThreadListResponse, RemoteThreadInitializeResponse, RemoteThreadMetadata } from "@assistant-ui/core";
import { createAssistantStream } from "assistant-stream";
import { chatHistoryApi } from "./chat-history-api";
import type { ThreadMessage } from "@assistant-ui/core";

// ─── Thread list adapter ──────────────────────────────────────────────────────
// Maps the backend /chat-history API to AssistantUI's RemoteThreadListAdapter.

export class ChatHistoryThreadListAdapter implements RemoteThreadListAdapter {
  async list(): Promise<RemoteThreadListResponse> {
    const sessions = await chatHistoryApi.listSessions({ limit: 100 });
    return {
      threads: sessions.map((s) => ({
        remoteId: s.id,
        externalId: s.id,
        status: "regular" as const,
        title: s.title || undefined,
      })),
    };
  }

  async initialize(_threadId: string): Promise<RemoteThreadInitializeResponse> {
    const session = await chatHistoryApi.createSession({});
    return { remoteId: session.id, externalId: session.id };
  }

  async fetch(remoteId: string): Promise<RemoteThreadMetadata> {
    const session = await chatHistoryApi.getSession(remoteId);
    return {
      remoteId: session.id,
      externalId: session.id,
      status: "regular" as const,
      title: session.title || undefined,
    };
  }

  async rename(remoteId: string, newTitle: string): Promise<void> {
    await chatHistoryApi.updateSession(remoteId, { title: newTitle });
  }

  async archive(remoteId: string): Promise<void> {
    await chatHistoryApi.archiveSession(remoteId);
  }

  // unarchive is not yet supported by the backend; silently no-op
  async unarchive(_remoteId: string): Promise<void> {}

  // treat delete as archive since the backend has no hard-delete
  async delete(remoteId: string): Promise<void> {
    await chatHistoryApi.archiveSession(remoteId);
  }

  async generateTitle(remoteId: string, messages: readonly ThreadMessage[]) {
    const firstUser = messages.find((m) => m.role === "user");
    let title = "New Chat";
    if (firstUser) {
      const firstTextPart = firstUser.content.find((p) => p.type === "text");
      if (firstTextPart && "text" in firstTextPart) {
        title = (firstTextPart.text as string).slice(0, 80);
      }
    }

    // persist the derived title to the backend
    await chatHistoryApi.updateSession(remoteId, { title });

    return createAssistantStream((ctrl) => {
      ctrl.appendText(title);
      ctrl.close();
    });
  }
}

// ─── Per-thread history adapter ───────────────────────────────────────────────
// Loads existing messages for a session when AssistantUI switches to that thread.
// append() is a no-op because the backend persists messages via POST /api/chat.

export function createBackendHistoryAdapter(
  externalId: string | undefined,
): ThreadHistoryAdapter {
  return {
    withFormat<TMessage, TStorage extends Record<string, unknown>>(
      _formatAdapter: MessageFormatAdapter<TMessage, TStorage>,
    ): GenericThreadHistoryAdapter<TMessage> {
      return {
        async load(): Promise<MessageFormatRepository<TMessage>> {
          if (!externalId) return { messages: [] };

          const session = await chatHistoryApi.getSession(externalId);
          const msgs = session.messages.filter(
            (m) => m.role === "user" || m.role === "assistant",
          );

          if (msgs.length === 0) return { messages: [] };

          return {
            headId: msgs.at(-1)!.id,
            messages: msgs.map((m, i) => ({
              parentId: i === 0 ? null : msgs[i - 1].id,
              message: {
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                parts: [{ type: "text" as const, text: m.content }],
                createdAt: new Date(m.created_at),
              } as unknown as TMessage,
            })),
          };
        },

        async append(_item) {
          // no-op: backend stores messages via POST /api/chat
        },
      };
    },
  };
}
