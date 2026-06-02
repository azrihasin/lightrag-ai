import { AsyncLocalStorage } from 'node:async_hooks';
import { AnalyticsRunContext } from './analytics.types';

/**
 * Per-request blackboard carrier for the multi-agent analytics network.
 *
 * The master agent's stream is consumed inside `analyticsRunStore.run(...)`, so
 * every subagent tool invocation triggered while pulling the stream shares the
 * same `AnalyticsRunContext` instance. This is more robust than relying on
 * Mastra forwarding `requestContext` into nested sub-agent tool calls — the
 * AsyncLocalStorage context is preserved across the whole async execution chain.
 */
export const analyticsRunStore = new AsyncLocalStorage<AnalyticsRunContext>();

/** Returns the active run's blackboard, or undefined when called outside a run. */
export function currentRun(): AnalyticsRunContext | undefined {
  return analyticsRunStore.getStore();
}
