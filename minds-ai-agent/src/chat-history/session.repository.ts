import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHAT_DB_POOL, type ChatPool } from './chat-db';
import type { ChatSession, SessionWithMessages } from './chat-history.types';

export interface ListSessionsOptions {
  userId?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

function safeJson(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(raw as string);
  } catch {
    return null;
  }
}

function mapRow(row: Record<string, unknown>): ChatSession {
  return {
    id: row.id as string,
    user_id: (row.user_id as string | null) ?? null,
    title: row.title as string,
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
    archived_at: (row.archived_at as Date | null) ?? null,
    metadata: safeJson(row.metadata),
  };
}

@Injectable()
export class SessionRepository {
  constructor(@Inject(CHAT_DB_POOL) private readonly pool: ChatPool) {}

  async create(params: {
    userId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChatSession> {
    const id = randomUUID();
    const title = params.title ?? 'New Chat';
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    await this.pool.query(
      `INSERT INTO chat_sessions (id, user_id, title, metadata) VALUES (?, ?, ?, ?)`,
      [id, params.userId ?? null, title, metadata],
    );

    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM chat_sessions WHERE id = ?`,
      [id],
    );
    return mapRow(rows[0]);
  }

  async list(opts: ListSessionsOptions = {}): Promise<ChatSession[]> {
    const { userId, limit = 50, offset = 0, includeArchived = false } = opts;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (!includeArchived) {
      conditions.push('archived_at IS NULL');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM chat_sessions ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      params,
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<ChatSession | null> {
    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM chat_sessions WHERE id = ?`,
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findWithMessages(id: string): Promise<SessionWithMessages | null> {
    const session = await this.findById(id);
    if (!session) return null;

    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sequence_index ASC, created_at ASC`,
      [id],
    );

    const messages = rows.map((row) => ({
      id: row.id as string,
      session_id: row.session_id as string,
      parent_message_id: (row.parent_message_id as string | null) ?? null,
      sequence_index: row.sequence_index as number,
      role: row.role as ChatSession['id'],
      message_type: (row.message_type as string) ?? 'text',
      content: row.content as string,
      metadata: safeJson(row.metadata),
      tool_payload: safeJson(row.tool_payload),
      thinking_payload: safeJson(row.thinking_payload),
      model_name: (row.model_name as string | null) ?? null,
      input_tokens: (row.input_tokens as number | null) ?? null,
      output_tokens: (row.output_tokens as number | null) ?? null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    }));

    return { ...session, messages } as SessionWithMessages;
  }

  async update(id: string, patch: { title?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      fields.push('title = ?');
      params.push(patch.title.slice(0, 500));
    }
    if (patch.metadata !== undefined) {
      fields.push('metadata = ?');
      params.push(JSON.stringify(patch.metadata));
    }

    if (fields.length === 0) return;

    params.push(id);
    await this.pool.query(
      `UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`,
      params,
    );
  }

  async archive(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE chat_sessions SET archived_at = NOW(3) WHERE id = ? AND archived_at IS NULL`,
      [id],
    );
  }

  async touchUpdatedAt(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE chat_sessions SET updated_at = NOW(3) WHERE id = ?`,
      [id],
    );
  }
}
