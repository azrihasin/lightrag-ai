import type {
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatRepository,
} from "@assistant-ui/react";
import type { RemoteThreadListResponse, RemoteThreadInitializeResponse, RemoteThreadMetadata } from "@assistant-ui/core";
import { createAssistantStream } from "assistant-stream";
import { mastraThreadApi } from "./chat-history-api";
import { getResourceId } from "./resource-id";
import type { ThreadMessage } from "@assistant-ui/core";
import type { MastraMessage, MastraMessagePart } from "./chat-history-api";

// ─── Thread list adapter ──────────────────────────────────────────────────────
// Maps the backend /api/chat/threads Mastra API to AssistantUI's RemoteThreadListAdapter.

export class ChatHistoryThreadListAdapter implements RemoteThreadListAdapter {
  async list(): Promise<RemoteThreadListResponse> {
    const resourceId = getResourceId();
    try {
      const threads = await mastraThreadApi.listThreads(resourceId, 100);
      return {
        threads: threads.map((t) => ({
          remoteId: t.id,
          externalId: t.id,
          status: "regular" as const,
          title: t.title || undefined,
        })),
      };
    } catch (err) {
      console.error("[ChatHistoryThreadListAdapter] list() failed:", err);
      return { threads: [] };
    }
  }

  async initialize(_threadId: string): Promise<RemoteThreadInitializeResponse> {
    // Every brand-new thread gets its own fresh id. Restoring the thread from the
    // URL on refresh is handled separately via `initialThreadId` (see ChatPage),
    // so initialize() must NEVER reuse an existing thread's id here — doing so
    // would bind a new chat to an existing thread and clobber its title/messages.
    const id = crypto.randomUUID();
    return { remoteId: id, externalId: id };
  }

  async fetch(remoteId: string): Promise<RemoteThreadMetadata> {
    const resourceId = getResourceId();
    try {
      const threads = await mastraThreadApi.listThreads(resourceId, 200);
      const thread = threads.find((t) => t.id === remoteId);
      if (thread) {
        return {
          remoteId: thread.id,
          externalId: thread.id,
          status: "regular" as const,
          title: thread.title || undefined,
        };
      }
    } catch {
      // Session may not exist yet before the first message; fall through.
    }
    return { remoteId, externalId: remoteId, status: "regular" as const };
  }

  async rename(_remoteId: string, _newTitle: string): Promise<void> {
    // Mastra's updateThread method handles renames. We don't expose a rename
    // endpoint yet — silently no-op until one is added.
  }

  async archive(_remoteId: string): Promise<void> {
    // No archive in Mastra threads yet — no-op.
  }

  async unarchive(_remoteId: string): Promise<void> {}

  async delete(remoteId: string): Promise<void> {
    const resourceId = getResourceId();
    try {
      await mastraThreadApi.deleteThread(remoteId, resourceId);
    } catch (err) {
      console.error("[ChatHistoryThreadListAdapter] delete() failed:", err);
      throw err;
    }
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

    // Title is auto-set by Mastra on the thread after the first save; this
    // just returns the derived title to AssistantUI for local display.
    return createAssistantStream((ctrl) => {
      ctrl.appendText(title);
      ctrl.close();
    });
  }
}

// ─── Per-thread history adapter ───────────────────────────────────────────────
// Loads existing messages for a Mastra thread when AssistantUI switches to it.
// append() is a no-op because Mastra persists messages automatically.

function mastraPartsToAssistantParts(parts: MastraMessagePart[]): unknown[] {
  const result: unknown[] = [];

  for (const part of parts) {
    if (part.type === "reasoning" && part.reasoning) {
      result.push({ type: "reasoning", text: part.reasoning, status: { type: "complete" } });
    } else if (part.type === "tool-invocation" && part.toolInvocation) {
      const ti = part.toolInvocation as any;
      // The render_visualization tool is only persisted to carry the spec
      // structure; on reload the visualization is rebuilt via the rerun card,
      // so skip it here (otherwise it renders a redundant, data-less
      // "Render Visualization" timeline step).
      if ((ti.toolName ?? ti.name) === "render_visualization") {
        continue;
      }
      result.push({
        type: "tool-call",
        toolCallId: ti.toolCallId ?? ti.id ?? crypto.randomUUID(),
        toolName: ti.toolName ?? ti.name ?? "unknown",
        args: ti.args ?? ti.input ?? {},
        result:
          ti.result !== null && ti.result !== undefined
            ? typeof ti.result === "string"
              ? ti.result
              : JSON.stringify(ti.result)
            : undefined,
        isError: ti.state === "output-error",
        status: { type: "complete" },
      });
    } else if (part.type === "data" && (part as any).name === "spec") {
      result.push(part);
    }
    // text parts are appended last, handled separately below
  }

  return result;
}

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

          const resourceId = getResourceId();
          let msgs: MastraMessage[];
          try {
            msgs = await mastraThreadApi.getThreadMessages(externalId, resourceId);
          } catch {
            return { messages: [] };
          }

          if (!msgs.length) return { messages: [] };

          return {
            headId: msgs.at(-1)!.id,
            messages: msgs.map((m, i) => {
              const parts: unknown[] = [];

              if (m.role === "assistant") {
                // Add reasoning, tool-call parts first
                parts.push(...mastraPartsToAssistantParts(m.parts));

                // The SQL result table + visualization are NEVER persisted with
                // their row data (database data is not stored at rest). If this
                // turn ran a query, surface a "rerun" part so the UI can render a
                // card that re-executes the query and rebuilds the table + chart
                // on demand.
                const meta = m.metadata ?? {};

                // Database table names surfaced from the LightRAG retrieval are
                // persisted on the turn; replay them as `source-url` parts so the
                // muted source chips reappear on reload. AISDKMessageConverter maps
                // `source-url` → the internal `source` part ChatPage renders.
                const tables = meta.tables;
                if (Array.isArray(tables)) {
                  for (const table of tables) {
                    if (typeof table !== "string" || !table.trim()) continue;
                    parts.push({
                      type: "source-url",
                      sourceId: `table-${table.toLowerCase()}`,
                      url: table,
                      title: table,
                    });
                  }
                }

                const sql = meta.sql;
                if (typeof sql === "string" && sql.trim()) {
                  const cols = Array.isArray(meta.columns)
                    ? (meta.columns as Array<{ name: string }>).map((c) =>
                        typeof c === "string" ? c : c.name,
                      )
                    : [];
                  // Emit in AI SDK UIMessage format (`data-<name>`). The history
                  // loader runs every part through AISDKMessageConverter, which
                  // only recognises `data-` prefixed parts (converting them to the
                  // internal `{type:"data", name, data}` shape ChatPage reads).
                  // Emitting the internal shape here makes the converter drop it.
                  parts.push({
                    type: "data-rerun",
                    data: {
                      messageId: m.id,
                      sql,
                      columns: cols,
                      rowCount: typeof meta.rowCount === "number" ? meta.rowCount : null,
                    },
                  });
                }
              }

              // Text part always last for assistant; only part for user
              const textPart = m.parts.find((p) => p.type === "text");
              parts.push({ type: "text" as const, text: textPart?.text ?? "" });

              return {
                parentId: i === 0 ? null : msgs[i - 1].id,
                message: {
                  id: m.id,
                  role: m.role as "user" | "assistant",
                  parts,
                  createdAt: new Date(m.createdAt),
                } as unknown as TMessage,
              };
            }),
          };
        },

        async append(_item) {
          // no-op: Mastra writes messages via the stream endpoint
        },
      };
    },
  };
}
