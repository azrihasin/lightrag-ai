/**
 * Custom fetch wrapper for AssistantChatTransport.
 *
 * Intercepts the SSE response stream and:
 *  - Extracts `tool-output-delta` events → routes deltas to the tool output
 *    stream store (so components can display streaming text in real-time).
 *  - Strips `tool-output-delta` events from the stream so the AI SDK transport
 *    never sees them (it only needs the final `tool-output-available`).
 *  - Extracts `progress` events → routes them to the progress store for the
 *    AgentTimeline component; strips them from the transport stream.
 *  - Observes `start` / `finish` events to manage progress session lifecycle.
 *  - All other SSE events pass through unchanged.
 */
import { useToolOutputStreamStore } from "./tool-output-stream";
import { useProgressStore } from "./progress-store";
import { useToolAnnotationStore } from "./tool-annotation-stream";
import { useSqlTableStreamStore } from "./sql-table-stream";
import { useSqlGeneratedStore } from "./sql-generated-store";
import { useJmespathStore } from "./jmespath-store";

type FetchFn = typeof globalThis.fetch;

export function createStreamingFetch(): FetchFn {
  return async (input, init) => {
    const response = await globalThis.fetch(input as RequestInfo, init);
    if (!response.body) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });

        // Split on SSE event boundaries (\n\n)
        const events = buffer.split("\n\n");
        // Last element may be an incomplete event — keep it in the buffer
        buffer = events.pop() ?? "";

        const passThrough: string[] = [];

        for (const raw of events) {
          if (!raw.trim()) continue;

          const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            const payload = dataLine.slice(6).trim();
            try {
              const event = JSON.parse(payload);

              if (event.type === "tool-output-delta") {
                // Route to store, do NOT forward to the transport
                useToolOutputStreamStore
                  .getState()
                  .appendDelta(event.toolCallId, event.delta);
                continue;
              }

              if (event.type === "sql-generated") {
                useSqlGeneratedStore
                  .getState()
                  .setQuery(event.toolCallId, event.sql ?? "", event.dialect ?? "postgres");
                continue;
              }

              if (event.type === "jmespath-query") {
                useJmespathStore
                  .getState()
                  .setEntry(event.toolCallId, event.query ?? "", event.component ?? "");
                continue;
              }

              if (event.type === "sql-table-start") {
                useSqlTableStreamStore
                  .getState()
                  .startTable(event.toolCallId, event.columns ?? []);
                continue;
              }

              if (event.type === "sql-table-row") {
                useSqlTableStreamStore
                  .getState()
                  .addRow(event.toolCallId, event.row ?? {});
                continue;
              }

              if (event.type === "sql-table-end") {
                useSqlTableStreamStore
                  .getState()
                  .endTable(event.toolCallId, event.rowCount ?? 0);
                continue;
              }

              if (event.type === "pre-tool-text-delta") {
                useToolAnnotationStore
                  .getState()
                  .appendPreDelta(event.toolCallId, event.delta);
                continue;
              }

              if (event.type === "pre-tool-text-complete") {
                useToolAnnotationStore
                  .getState()
                  .setPreComplete(event.toolCallId);
                continue;
              }

              if (event.type === "post-tool-text-delta") {
                useToolAnnotationStore
                  .getState()
                  .appendPostDelta(event.toolCallId, event.delta);
                continue;
              }

              if (event.type === "post-tool-text-complete") {
                useToolAnnotationStore
                  .getState()
                  .setPostComplete(event.toolCallId);
                continue;
              }

              if (event.type === "start") {
                // Begin a new progress session; also pass through to AI SDK
                useProgressStore.getState().startSession();
                // fall through to passThrough
              }

              if (event.type === "progress") {
                // Route to progress store and strip from transport stream
                useProgressStore.getState().addEvent({
                  phase: event.phase ?? "unknown",
                  step: event.step ?? "",
                  status: event.status ?? "running",
                  message: event.message ?? "",
                  detail: event.detail,
                  substepId: event.substepId,
                });
                continue; // strip — AI SDK does not need this event
              }

              if (event.type === "finish") {
                // Mark session complete; also pass through to AI SDK
                useProgressStore.getState().finishSession();
                // fall through to passThrough
              }
            } catch {
              // Not JSON (e.g. "[DONE]") — fall through to passThrough
            }
          }

          passThrough.push(raw + "\n\n");
        }

        if (passThrough.length > 0) {
          controller.enqueue(encoder.encode(passThrough.join("")));
        }
      },

      flush(controller) {
        // Flush any remaining buffered data
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(buffer + "\n\n"));
          buffer = "";
        }
      },
    });

    return new Response(response.body.pipeThrough(transformStream), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
