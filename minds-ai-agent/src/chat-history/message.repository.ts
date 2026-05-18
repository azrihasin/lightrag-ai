import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { CHAT_DB_POOL, type ChatPool } from './chat-db';
import type { NewMessage } from './chat-history.types';

const STORE_THINKING = process.env.CHAT_STORE_THINKING !== 'false';

function safeStringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

@Injectable()
export class MessageRepository {
  constructor(@Inject(CHAT_DB_POOL) private readonly pool: ChatPool) {}

  async nextSequenceIndex(sessionId: string, conn?: PoolConnection): Promise<number> {
    const runner = conn ?? this.pool;
    const rows = await runner.query<{ max_seq: number | null }[]>(
      `SELECT MAX(sequence_index) AS max_seq FROM chat_messages WHERE session_id = ?`,
      [sessionId],
    );
    const max = rows[0]?.max_seq;
    return (max === null || max === undefined) ? 0 : max + 1;
  }

  async insertMany(sessionId: string, messages: NewMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      let nextSeq = await this.nextSequenceIndex(sessionId, conn);

      for (const msg of messages) {
        if (!STORE_THINKING && msg.role === 'thinking') continue;

        const id = msg.id ?? randomUUID();
        const seqIndex = msg.sequence_index >= nextSeq ? msg.sequence_index : nextSeq;
        nextSeq = seqIndex + 1;

        const thinkingPayload = STORE_THINKING
          ? safeStringify(msg.thinking_payload)
          : null;

        await conn.query(
          `INSERT INTO chat_messages
            (id, session_id, parent_message_id, sequence_index, role, message_type,
             content, metadata, tool_payload, thinking_payload,
             model_name, input_tokens, output_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            sessionId,
            msg.parent_message_id ?? null,
            seqIndex,
            msg.role,
            msg.message_type ?? 'text',
            msg.content,
            safeStringify(msg.metadata),
            safeStringify(msg.tool_payload),
            thinkingPayload,
            msg.model_name ?? null,
            msg.input_tokens ?? null,
            msg.output_tokens ?? null,
          ],
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async countForSession(sessionId: string): Promise<number> {
    const rows = await this.pool.query<{ cnt: number }[]>(
      `SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = ?`,
      [sessionId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}
