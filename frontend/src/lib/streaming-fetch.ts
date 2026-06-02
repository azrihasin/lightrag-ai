/**
 * Custom fetch wrapper for AssistantChatTransport.
 *
 * Intercepts the SSE response stream and:
 *  - Routes agent harness events (goal_received, step_started, step_completed,
 *    agent_iteration, agent_final, agent_error) to useAgentHarnessStore; strips
 *    them from the transport stream so AssistantUI never sees them.
 *  - Extracts `tool-output-delta` events → routes deltas to the tool output
 *    stream store; strips them from the transport stream.
 *  - Extracts `sql-*` and `jmespath-query` sidecar events → routes to their
 *    respective stores; strips them from the transport stream.
 *  - Extracts `progress` events → routes to useProgressStore; strips them.
 *  - Observes `start` / `finish` events to manage progress session lifecycle.
 *  - All other SSE events pass through to AssistantUI unchanged.
 */
import { useToolOutputStreamStore } from './tool-output-stream';
import { useProgressStore } from './progress-store';
import { useToolAnnotationStore } from './tool-annotation-stream';
import { useSqlTableStreamStore } from './sql-table-stream';
import { useSqlGeneratedStore } from './sql-generated-store';
import { useJmespathStore } from './jmespath-store';
import { useAgentHarnessStore } from './agent-harness-store';
import { AGENT_HARNESS_EVENT_TYPES } from './agent-events.types';

type FetchFn = typeof globalThis.fetch;

export function createStreamingFetch(): FetchFn {
  return async (input, init) => {
    const response = await globalThis.fetch(input as RequestInfo, init);
    if (!response.body) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });

        // Split on SSE event boundaries (\n\n)
        const events = buffer.split('\n\n');
        // Last element may be an incomplete event — keep it in the buffer
        buffer = events.pop() ?? '';

        const passThrough: string[] = [];

        for (const raw of events) {
          if (!raw.trim()) continue;

          const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) {
            const payload = dataLine.slice(6).trim();
            try {
              const event = JSON.parse(payload) as Record<string, unknown>;
              const eventType = event['type'] as string | undefined;

              // ── Agent harness events ────────────────────────────────────────
              if (eventType && AGENT_HARNESS_EVENT_TYPES.has(eventType)) {
                const store = useAgentHarnessStore.getState();

                switch (eventType) {
                  // ── Legacy supervisor-path events ───────────────────────────
                  case 'goal_received':
                    store.setGoal(
                      (event['goal'] as string) ?? '',
                      (event['sessionId'] as string) ?? '',
                    );
                    break;

                  case 'step_started':
                    store.startStep(
                      (event['stepId'] as string) ?? '',
                      (event['agentName'] as string) ?? '',
                    );
                    break;

                  case 'step_completed':
                    store.completeStep(
                      (event['stepId'] as string) ?? '',
                      (event['durationMs'] as number) ?? 0,
                    );
                    break;

                  case 'agent_iteration':
                    store.setIteration((event['iteration'] as number) ?? 0);
                    break;

                  case 'agent_final':
                    store.finish(
                      (event['totalIterations'] as number) ?? 0,
                      (event['totalToolCalls'] as number) ?? 0,
                      (event['durationMs'] as number) ?? 0,
                    );
                    break;

                  case 'agent_error':
                    store.setError((event['message'] as string) ?? 'Unknown error');
                    break;

                  // ── DataAgentHarness events (wrapped as {type:'data-harness',data:innerEvent}) ──
                  case 'data-harness': {
                    const inner = event['data'] as Record<string, unknown> | undefined;
                    const innerType = inner?.['type'] as string | undefined;
                    if (innerType === 'agent.started') {
                      const runId = (inner?.['runId'] as string) ?? '';
                      const mode = (inner?.['mode'] as string) ?? '';
                      const agent = (inner?.['agent'] as string) ?? '';
                      store.startStep(`${runId}:${mode}:${agent}`, agent);
                    } else if (innerType === 'agent.delta') {
                      const runId = (inner?.['runId'] as string) ?? '';
                      const mode = (inner?.['mode'] as string) ?? '';
                      const agent = (inner?.['agent'] as string) ?? '';
                      const textDelta = (inner?.['textDelta'] as string) ?? '';
                      store.appendStepText(`${runId}:${mode}:${agent}`, textDelta);
                    } else if (innerType === 'agent.completed') {
                      const runId = (inner?.['runId'] as string) ?? '';
                      const mode = (inner?.['mode'] as string) ?? '';
                      const agent = (inner?.['agent'] as string) ?? '';
                      store.completeStep(`${runId}:${mode}:${agent}`, 0);
                    } else if (innerType === 'run.failed') {
                      const payload = inner?.['payload'] as Record<string, unknown> | undefined;
                      store.setError((payload?.['errorMessage'] as string) ?? 'Harness run failed');
                    }
                    // run.started, run.completed, agent.delta, tool.started,
                    // tool.completed, mode.changed, audit.completed — strip silently
                    break;
                  }
                }
                continue; // strip — AssistantUI does not need harness events
              }

              // ── Tool output delta ───────────────────────────────────────────
              if (eventType === 'tool-output-delta') {
                useToolOutputStreamStore
                  .getState()
                  .appendDelta(event['toolCallId'] as string, event['delta'] as string);
                continue;
              }

              // ── SQL sidecar events ──────────────────────────────────────────
              if (eventType === 'sql-generated') {
                useSqlGeneratedStore
                  .getState()
                  .setQuery(event['toolCallId'] as string, (event['sql'] as string) ?? '', (event['dialect'] as string) ?? 'postgres');
                continue;
              }

              if (eventType === 'jmespath-query') {
                useJmespathStore
                  .getState()
                  .setEntry(event['toolCallId'] as string, (event['query'] as string) ?? '', (event['component'] as string) ?? '');
                continue;
              }

              if (eventType === 'sql-table-start') {
                useSqlTableStreamStore
                  .getState()
                  .startTable(event['toolCallId'] as string, (event['columns'] as string[]) ?? []);
                continue;
              }

              if (eventType === 'sql-table-row') {
                useSqlTableStreamStore
                  .getState()
                  .addRow(event['toolCallId'] as string, (event['row'] as Record<string, unknown>) ?? {});
                continue;
              }

              if (eventType === 'sql-table-end') {
                useSqlTableStreamStore
                  .getState()
                  .endTable(event['toolCallId'] as string, (event['rowCount'] as number) ?? 0);
                continue;
              }

              // ── Tool annotation events ──────────────────────────────────────
              if (eventType === 'pre-tool-text-delta') {
                useToolAnnotationStore
                  .getState()
                  .appendPreDelta(event['toolCallId'] as string, event['delta'] as string);
                continue;
              }

              if (eventType === 'pre-tool-text-complete') {
                useToolAnnotationStore.getState().setPreComplete(event['toolCallId'] as string);
                continue;
              }

              if (eventType === 'post-tool-text-delta') {
                useToolAnnotationStore
                  .getState()
                  .appendPostDelta(event['toolCallId'] as string, event['delta'] as string);
                continue;
              }

              if (eventType === 'post-tool-text-complete') {
                useToolAnnotationStore.getState().setPostComplete(event['toolCallId'] as string);
                continue;
              }

              // ── Progress / lifecycle events ─────────────────────────────────
              if (eventType === 'start') {
                useProgressStore.getState().startSession();
                // fall through to passThrough
              }

              if (eventType === 'progress') {
                useProgressStore.getState().addEvent({
                  phase: (event['phase'] as string) ?? 'unknown',
                  step: (event['step'] as string) ?? '',
                  status: (event['status'] as 'running' | 'complete' | 'error') ?? 'running',
                  message: (event['message'] as string) ?? '',
                  detail: event['detail'] as string | undefined,
                  substepId: event['substepId'] as string | undefined,
                });
                continue; // strip — AI SDK does not need this event
              }

              if (eventType === 'finish') {
                useProgressStore.getState().finishSession();
                // fall through to passThrough
              }
            } catch {
              // Not JSON (e.g. "[DONE]") — fall through to passThrough
            }
          }

          passThrough.push(raw + '\n\n');
        }

        if (passThrough.length > 0) {
          controller.enqueue(encoder.encode(passThrough.join('')));
        }
      },

      flush(controller) {
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(buffer + '\n\n'));
          buffer = '';
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
