import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as z from 'zod';
import type { ModelProvider } from '../providers/model.provider';
import type { AgentConfig } from './agent-types';

export async function callTool<T>(t: { invoke(i: unknown): Promise<unknown> }, input: unknown): Promise<T> {
  const raw = await t.invoke(input);
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  }
  return raw as T;
}

export function parseJsonFromRaw<T>(raw: string, schema: z.ZodType<T>): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM did not return JSON. Got: ${raw.slice(0, 200)}`);
  return schema.parse(JSON.parse(match[0]));
}

export function extractDelta(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('');
  }
  return '';
}

export async function streamText(
  model: ReturnType<ModelProvider['getChatModel']>,
  messages: (SystemMessage | HumanMessage)[],
  config: AgentConfig,
): Promise<string> {
  let text = '';
  for await (const chunk of await model.stream(messages, config)) {
    text += extractDelta(chunk.content);
  }
  return text;
}

export function terminalLog(mode: string, node: string | undefined, payload: unknown): void {
  const ts = new Date().toISOString();
  const modeCol = mode.padEnd(8);
  const nodeCol = (node ?? '—').padEnd(28);
  process.stdout.write(`[${ts}] [${modeCol}] [${nodeCol}] ${JSON.stringify(payload)}\n`);
}
