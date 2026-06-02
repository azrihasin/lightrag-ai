/**
 * Custom Mastra storage adapter backed by MariaDB.
 *
 * Implements the MemoryStorage domain from @mastra/core/storage using the
 * existing MariaDB connection pool. Data is stored in four normalized tables:
 *
 *   mastra_threads       — thread records (id, resource_id, title, metadata)
 *   mastra_messages      — message headers (id, thread_id, resource_id, role, type)
 *   mastra_message_parts — individual content parts per message (normalized)
 *   mastra_resources     — per-user working memory and metadata
 *
 * JSON columns are used only for flexible/variable data: thread metadata,
 * tool-invocation payloads (args + results), and unrecognised part types.
 */

import { randomUUID } from 'node:crypto';
import type { MastraMessageContentV2 } from '@mastra/core/agent';
import type { MastraDBMessage, StorageThreadType } from '@mastra/core/memory';
import { MemoryStorage, MastraCompositeStore } from '@mastra/core/storage';
import type {
  StorageListMessagesInput,
  StorageListMessagesByResourceIdInput,
  StorageListMessagesOutput,
  StorageListThreadsInput,
  StorageListThreadsOutput,
  StorageResourceType,
} from '@mastra/core/storage';
import { MessageList } from '@mastra/core/agent';
import type { CHAT_DB_POOL, ChatPool } from '../../chat-history/chat-db';

// ─── Schema DDL ───────────────────────────────────────────────────────────────

export const MASTRA_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS mastra_threads (
  id          VARCHAR(36)   NOT NULL,
  resource_id VARCHAR(255)  NOT NULL,
  title       VARCHAR(500)  NOT NULL DEFAULT '',
  metadata    JSON,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_mastra_threads_resource (resource_id),
  INDEX idx_mastra_threads_updated  (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mastra_messages (
  id              VARCHAR(36)   NOT NULL,
  thread_id       VARCHAR(36)   NOT NULL,
  resource_id     VARCHAR(255),
  role            VARCHAR(50)   NOT NULL,
  type            VARCHAR(50)   NOT NULL DEFAULT 'text',
  msg_metadata    JSON,
  provider_meta   JSON,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_mastra_msg_thread_created (thread_id, created_at),
  INDEX idx_mastra_msg_resource       (resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mastra_message_parts (
  id              VARCHAR(36)    NOT NULL,
  message_id      VARCHAR(36)    NOT NULL,
  part_order      INT UNSIGNED   NOT NULL,
  part_type       VARCHAR(50)    NOT NULL,
  text_content    LONGTEXT,
  tool_invocation JSON,
  json_payload    JSON,
  created_at      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_mastra_parts_msg (message_id, part_order),
  CONSTRAINT fk_mastra_parts_msg
    FOREIGN KEY (message_id) REFERENCES mastra_messages(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mastra_resources (
  id              VARCHAR(255)  NOT NULL,
  working_memory  TEXT,
  metadata        JSON,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJson(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try { return JSON.parse(raw as string); } catch { return null; }
}

function ensureDate(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(v as string | number);
}

// Serialise a content part row for INSERT.
interface PartRow {
  id: string;
  message_id: string;
  part_order: number;
  part_type: string;
  text_content: string | null;
  tool_invocation: string | null;
  json_payload: string | null;
}

function partToRow(messageId: string, order: number, part: Record<string, unknown>): PartRow {
  const partType = (part['type'] as string) ?? 'unknown';
  let text_content: string | null = null;
  let tool_invocation: string | null = null;
  let json_payload: string | null = null;

  if (partType === 'text') {
    text_content = (part['text'] as string) ?? '';
  } else if (partType === 'reasoning') {
    text_content = (part['reasoning'] as string) ?? '';
  } else if (partType === 'step-start') {
    // model field stored in json_payload for optional restoration
    if (part['model']) json_payload = JSON.stringify({ model: part['model'] });
  } else if (partType === 'tool-invocation') {
    tool_invocation = JSON.stringify(part['toolInvocation'] ?? {});
    if (part['title']) {
      json_payload = JSON.stringify({ title: part['title'], providerExecuted: part['providerExecuted'] });
    }
  } else {
    // source-url, source-document, file, data-part, etc.
    json_payload = JSON.stringify(part);
  }

  return { id: randomUUID(), message_id: messageId, part_order: order, part_type: partType, text_content, tool_invocation, json_payload };
}

function rowToPart(row: Record<string, unknown>): Record<string, unknown> {
  const partType = row['part_type'] as string;
  if (partType === 'text') {
    return { type: 'text', text: (row['text_content'] as string) ?? '' };
  }
  if (partType === 'reasoning') {
    return { type: 'reasoning', reasoning: (row['text_content'] as string) ?? '' };
  }
  if (partType === 'step-start') {
    const extra = safeJson(row['json_payload']);
    return { type: 'step-start', ...(extra ?? {}) };
  }
  if (partType === 'tool-invocation') {
    const ti = safeJson(row['tool_invocation']) ?? {};
    const meta = safeJson(row['json_payload']);
    return { type: 'tool-invocation', toolInvocation: ti, ...(meta ?? {}) };
  }
  // Generic: restore from json_payload
  const payload = safeJson(row['json_payload']);
  if (payload) return payload;
  return { type: partType };
}

// Reconstruct a MastraDBMessage from DB rows.
function buildMessage(
  msgRow: Record<string, unknown>,
  partRows: Record<string, unknown>[],
): MastraDBMessage {
  const parts = partRows.map(rowToPart);
  const content: MastraMessageContentV2 = {
    format: 2,
    parts: parts as MastraMessageContentV2['parts'],
    metadata: safeJson(msgRow['msg_metadata']) ?? undefined,
    providerMetadata: (safeJson(msgRow['provider_meta']) ?? undefined) as MastraMessageContentV2['providerMetadata'],
  };

  return {
    id: msgRow['id'] as string,
    threadId: msgRow['thread_id'] as string,
    resourceId: (msgRow['resource_id'] as string | null) ?? undefined,
    role: msgRow['role'] as MastraDBMessage['role'],
    type: (msgRow['type'] as string) ?? 'text',
    createdAt: ensureDate(msgRow['created_at']),
    content,
  };
}

// ─── MariaDB Memory Storage Domain ───────────────────────────────────────────

export class MariaDBMemoryStorage extends MemoryStorage {
  constructor(private readonly pool: ChatPool) {
    super();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const statements = MASTRA_TABLES_DDL.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const conn = await this.pool.getConnection();
    try {
      for (const sql of statements) {
        await conn.query(sql);
      }
    } finally {
      conn.release();
    }
  }

  async dangerouslyClearAll(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      await conn.query('TRUNCATE TABLE mastra_message_parts');
      await conn.query('TRUNCATE TABLE mastra_messages');
      await conn.query('TRUNCATE TABLE mastra_threads');
      await conn.query('TRUNCATE TABLE mastra_resources');
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  }

  // ── Threads ────────────────────────────────────────────────────────────────

  async getThreadById({ threadId, resourceId }: { threadId: string; resourceId?: string }): Promise<StorageThreadType | null> {
    const conditions = ['id = ?'];
    const params: unknown[] = [threadId];
    if (resourceId) { conditions.push('resource_id = ?'); params.push(resourceId); }

    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_threads WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params,
    );
    if (!rows.length) return null;
    return this._mapThreadRow(rows[0]);
  }

  async saveThread({ thread }: { thread: StorageThreadType }): Promise<StorageThreadType> {
    const metadata = thread.metadata ? JSON.stringify(thread.metadata) : null;
    const now = new Date();

    await this.pool.query(
      `INSERT INTO mastra_threads (id, resource_id, title, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         resource_id = VALUES(resource_id),
         title       = VALUES(title),
         metadata    = VALUES(metadata),
         updated_at  = VALUES(updated_at)`,
      [thread.id, thread.resourceId, thread.title ?? '', metadata, thread.createdAt ?? now, thread.updatedAt ?? now],
    );

    return (await this.getThreadById({ threadId: thread.id }))!;
  }

  async updateThread({ id, title, metadata }: { id: string; title: string; metadata: Record<string, unknown> }): Promise<StorageThreadType> {
    await this.pool.query(
      `UPDATE mastra_threads SET title = ?, metadata = ?, updated_at = NOW(3) WHERE id = ?`,
      [title, JSON.stringify(metadata), id],
    );
    const thread = await this.getThreadById({ threadId: id });
    if (!thread) throw new Error(`Thread ${id} not found after update`);
    return thread;
  }

  async deleteThread({ threadId }: { threadId: string }): Promise<void> {
    // Cascade: mastra_messages -> mastra_message_parts deleted via FK
    await this.pool.query(`DELETE FROM mastra_messages WHERE thread_id = ?`, [threadId]);
    await this.pool.query(`DELETE FROM mastra_threads WHERE id = ?`, [threadId]);
  }

  async listThreads(args: StorageListThreadsInput): Promise<StorageListThreadsOutput> {
    const perPageInput = args.perPage;
    const page = args.page ?? 0;
    const perPage = perPageInput === false ? Number.MAX_SAFE_INTEGER : (perPageInput ?? 100);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (args.filter?.resourceId) {
      conditions.push('resource_id = ?');
      params.push(args.filter.resourceId);
    }

    if (args.filter?.metadata && Object.keys(args.filter.metadata).length > 0) {
      for (const [key, value] of Object.entries(args.filter.metadata)) {
        conditions.push(`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.${key}')) = ?`);
        params.push(String(value));
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const orderField = args.orderBy?.field === 'createdAt' ? 'created_at' : 'updated_at';
    const orderDir = (args.orderBy?.direction ?? 'DESC').toUpperCase();

    const [totalRows] = await this.pool.query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as cnt FROM mastra_threads ${where}`,
      [...params],
    );
    const total = Number((totalRows as any)['cnt'] ?? 0);

    const offset = page * perPage;
    const limitedParams = [...params, perPage === Number.MAX_SAFE_INTEGER ? 999999999 : perPage, offset];

    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_threads ${where} ORDER BY ${orderField} ${orderDir} LIMIT ? OFFSET ?`,
      limitedParams,
    );

    return {
      threads: rows.map(r => this._mapThreadRow(r)),
      total,
      page,
      perPage: perPageInput === false ? false : perPage,
      hasMore: total > offset + rows.length,
    };
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async saveMessages({ messages }: { messages: MastraDBMessage[] }): Promise<{ messages: MastraDBMessage[] }> {
    if (!messages.length) return { messages: [] };

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const msg of messages) {
        const msgMeta = msg.content?.format === 2 ? (msg.content.metadata ?? null) : null;
        const provMeta = msg.content?.format === 2 ? (msg.content.providerMetadata ?? null) : null;

        await conn.query(
          `INSERT INTO mastra_messages (id, thread_id, resource_id, role, type, msg_metadata, provider_meta, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             thread_id     = VALUES(thread_id),
             resource_id   = VALUES(resource_id),
             role          = VALUES(role),
             type          = VALUES(type),
             msg_metadata  = VALUES(msg_metadata),
             provider_meta = VALUES(provider_meta)`,
          [
            msg.id,
            msg.threadId ?? null,
            msg.resourceId ?? null,
            msg.role,
            (msg as any).type ?? 'text',
            msgMeta ? JSON.stringify(msgMeta) : null,
            provMeta ? JSON.stringify(provMeta) : null,
            msg.createdAt ?? new Date(),
          ],
        );

        // Always re-insert parts to keep them in sync
        await conn.query(`DELETE FROM mastra_message_parts WHERE message_id = ?`, [msg.id]);

        const parts = this._extractParts(msg);
        for (let i = 0; i < parts.length; i++) {
          const row = partToRow(msg.id, i, parts[i]);
          await conn.query(
            `INSERT INTO mastra_message_parts (id, message_id, part_order, part_type, text_content, tool_invocation, json_payload)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [row.id, row.message_id, row.part_order, row.part_type, row.text_content, row.tool_invocation, row.json_payload],
          );
        }
      }

      await conn.commit();
      return { messages };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateMessages({ messages }: {
    messages: (Partial<Omit<MastraDBMessage, 'createdAt'>> & {
      id: string;
      content?: { metadata?: MastraMessageContentV2['metadata']; content?: MastraMessageContentV2['content'] };
    })[];
  }): Promise<MastraDBMessage[]> {
    const results: MastraDBMessage[] = [];

    for (const patch of messages) {
      // Load current state
      const current = await this._getMessageById(patch.id);
      if (!current) continue;

      // Apply partial content updates
      let newContent: MastraMessageContentV2 = current.content as MastraMessageContentV2;
      if (patch.content) {
        if (patch.content.metadata !== undefined) {
          newContent = { ...newContent, metadata: patch.content.metadata };
        }
        if (patch.content.content !== undefined) {
          newContent = { ...newContent, content: patch.content.content };
        }
      }

      const updated: MastraDBMessage = {
        ...current,
        ...(patch.role ? { role: patch.role } : {}),
        content: newContent,
      };

      await this.saveMessages({ messages: [updated] });
      results.push(updated);
    }

    return results;
  }

  async deleteMessages(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    const placeholders = messageIds.map(() => '?').join(',');
    await this.pool.query(`DELETE FROM mastra_messages WHERE id IN (${placeholders})`, messageIds);
  }

  async listMessages(args: StorageListMessagesInput): Promise<StorageListMessagesOutput> {
    const threadIds = Array.isArray(args.threadId) ? args.threadId : [args.threadId];
    if (!threadIds.length) return { messages: [], total: 0, page: 0, perPage: args.perPage ?? 40, hasMore: false };

    const perPageInput = args.perPage;
    const page = args.page ?? 0;
    const perPage = perPageInput === false ? Number.MAX_SAFE_INTEGER : (perPageInput ?? 40);

    const placeholders = threadIds.map(() => '?').join(',');
    const conditions = [`thread_id IN (${placeholders})`];
    const params: unknown[] = [...threadIds];

    if (args.resourceId) { conditions.push('resource_id = ?'); params.push(args.resourceId); }

    const filter = (args as any).filter;
    if (filter?.dateRange?.start) {
      conditions.push(filter.dateRange.startExclusive ? 'created_at > ?' : 'created_at >= ?');
      params.push(filter.dateRange.start);
    }
    if (filter?.dateRange?.end) {
      conditions.push(filter.dateRange.endExclusive ? 'created_at < ?' : 'created_at <= ?');
      params.push(filter.dateRange.end);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const dir = (args.orderBy?.direction ?? 'ASC').toUpperCase();

    const [countRow] = await this.pool.query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as cnt FROM mastra_messages ${where}`, [...params],
    );
    const total = Number((countRow as any)['cnt'] ?? 0);

    const offset = perPage === Number.MAX_SAFE_INTEGER ? 0 : page * perPage;
    const msgRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_messages ${where} ORDER BY created_at ${dir} LIMIT ? OFFSET ?`,
      [...params, perPage === Number.MAX_SAFE_INTEGER ? 999999999 : perPage, offset],
    );

    if (!msgRows.length) return { messages: [], total, page, perPage: perPageInput === false ? false : perPage, hasMore: false };

    const msgIds = msgRows.map(r => r['id'] as string);
    const partPlaceholders = msgIds.map(() => '?').join(',');
    const partRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_message_parts WHERE message_id IN (${partPlaceholders}) ORDER BY message_id, part_order ASC`,
      msgIds,
    );

    // Group parts by message id
    const partsByMsg = new Map<string, Record<string, unknown>[]>();
    for (const p of partRows) {
      const mid = p['message_id'] as string;
      if (!partsByMsg.has(mid)) partsByMsg.set(mid, []);
      partsByMsg.get(mid)!.push(p);
    }

    const rawMessages = msgRows.map(r => buildMessage(r, partsByMsg.get(r['id'] as string) ?? []));

    // Normalise through MessageList to apply Mastra's format compat
    const list = new MessageList().add(rawMessages as any, 'memory');
    const normalized = list.get.all.db();

    return {
      messages: normalized,
      total,
      page,
      perPage: perPageInput === false ? false : perPage,
      hasMore: total > offset + msgRows.length,
    };
  }

  async listMessagesByResourceId(args: StorageListMessagesByResourceIdInput): Promise<StorageListMessagesOutput> {
    const perPageInput = args.perPage;
    const page = args.page ?? 0;
    const perPage = perPageInput === false ? Number.MAX_SAFE_INTEGER : (perPageInput ?? 40);

    const conditions = ['resource_id = ?'];
    const params: unknown[] = [args.resourceId];

    const filter = (args as any).filter;
    if (filter?.dateRange?.start) {
      conditions.push(filter.dateRange.startExclusive ? 'created_at > ?' : 'created_at >= ?');
      params.push(filter.dateRange.start);
    }
    if (filter?.dateRange?.end) {
      conditions.push(filter.dateRange.endExclusive ? 'created_at < ?' : 'created_at <= ?');
      params.push(filter.dateRange.end);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const dir = (args.orderBy?.direction ?? 'ASC').toUpperCase();

    const [countRow] = await this.pool.query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as cnt FROM mastra_messages ${where}`, [...params],
    );
    const total = Number((countRow as any)['cnt'] ?? 0);
    const offset = perPage === Number.MAX_SAFE_INTEGER ? 0 : page * perPage;

    const msgRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_messages ${where} ORDER BY created_at ${dir} LIMIT ? OFFSET ?`,
      [...params, perPage === Number.MAX_SAFE_INTEGER ? 999999999 : perPage, offset],
    );

    if (!msgRows.length) return { messages: [], total, page, perPage: perPageInput === false ? false : perPage, hasMore: false };

    const msgIds = msgRows.map(r => r['id'] as string);
    const partPlaceholders = msgIds.map(() => '?').join(',');
    const partRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_message_parts WHERE message_id IN (${partPlaceholders}) ORDER BY message_id, part_order ASC`,
      msgIds,
    );

    const partsByMsg = new Map<string, Record<string, unknown>[]>();
    for (const p of partRows) {
      const mid = p['message_id'] as string;
      if (!partsByMsg.has(mid)) partsByMsg.set(mid, []);
      partsByMsg.get(mid)!.push(p);
    }

    const rawMessages = msgRows.map(r => buildMessage(r, partsByMsg.get(r['id'] as string) ?? []));
    const list = new MessageList().add(rawMessages as any, 'memory');
    const normalized = list.get.all.db();

    return { messages: normalized, total, page, perPage: perPageInput === false ? false : perPage, hasMore: false };
  }

  async listMessagesById({ messageIds }: { messageIds: string[] }): Promise<{ messages: MastraDBMessage[] }> {
    if (!messageIds.length) return { messages: [] };

    const placeholders = messageIds.map(() => '?').join(',');
    const msgRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_messages WHERE id IN (${placeholders})`,
      messageIds,
    );
    if (!msgRows.length) return { messages: [] };

    const partPlaceholders = messageIds.map(() => '?').join(',');
    const partRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_message_parts WHERE message_id IN (${partPlaceholders}) ORDER BY message_id, part_order ASC`,
      messageIds,
    );

    const partsByMsg = new Map<string, Record<string, unknown>[]>();
    for (const p of partRows) {
      const mid = p['message_id'] as string;
      if (!partsByMsg.has(mid)) partsByMsg.set(mid, []);
      partsByMsg.get(mid)!.push(p);
    }

    return { messages: msgRows.map(r => buildMessage(r, partsByMsg.get(r['id'] as string) ?? [])) };
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  async getResourceById({ resourceId }: { resourceId: string }): Promise<StorageResourceType | null> {
    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_resources WHERE id = ? LIMIT 1`,
      [resourceId],
    );
    if (!rows.length) return null;
    return this._mapResourceRow(rows[0]);
  }

  async saveResource({ resource }: { resource: StorageResourceType }): Promise<StorageResourceType> {
    const now = new Date();
    await this.pool.query(
      `INSERT INTO mastra_resources (id, working_memory, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         working_memory = VALUES(working_memory),
         metadata       = VALUES(metadata),
         updated_at     = VALUES(updated_at)`,
      [
        resource.id,
        resource.workingMemory ?? null,
        resource.metadata ? JSON.stringify(resource.metadata) : null,
        resource.createdAt ?? now,
        resource.updatedAt ?? now,
      ],
    );
    return (await this.getResourceById({ resourceId: resource.id }))!;
  }

  async updateResource({ resourceId, workingMemory, metadata }: {
    resourceId: string;
    workingMemory?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StorageResourceType> {
    const fields: string[] = ['updated_at = NOW(3)'];
    const params: unknown[] = [];

    if (workingMemory !== undefined) { fields.push('working_memory = ?'); params.push(workingMemory); }
    if (metadata !== undefined) { fields.push('metadata = ?'); params.push(JSON.stringify(metadata)); }

    params.push(resourceId);
    await this.pool.query(`UPDATE mastra_resources SET ${fields.join(', ')} WHERE id = ?`, params);

    const existing = await this.getResourceById({ resourceId });
    if (!existing) {
      const now = new Date();
      return this.saveResource({ resource: { id: resourceId, workingMemory, metadata, createdAt: now, updatedAt: now } });
    }
    return existing;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _mapThreadRow(row: Record<string, unknown>): StorageThreadType {
    return {
      id: row['id'] as string,
      resourceId: row['resource_id'] as string,
      title: (row['title'] as string) ?? '',
      metadata: safeJson(row['metadata']) ?? undefined,
      createdAt: ensureDate(row['created_at']),
      updatedAt: ensureDate(row['updated_at']),
    };
  }

  private _mapResourceRow(row: Record<string, unknown>): StorageResourceType {
    return {
      id: row['id'] as string,
      workingMemory: (row['working_memory'] as string | null) ?? undefined,
      metadata: safeJson(row['metadata']) ?? undefined,
      createdAt: ensureDate(row['created_at']),
      updatedAt: ensureDate(row['updated_at']),
    };
  }

  private async _getMessageById(id: string): Promise<MastraDBMessage | null> {
    const rows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_messages WHERE id = ? LIMIT 1`, [id],
    );
    if (!rows.length) return null;

    const partRows = await this.pool.query<Record<string, unknown>[]>(
      `SELECT * FROM mastra_message_parts WHERE message_id = ? ORDER BY part_order ASC`, [id],
    );
    return buildMessage(rows[0], partRows);
  }

  private _extractParts(msg: MastraDBMessage): Record<string, unknown>[] {
    const content = msg.content as MastraMessageContentV2 | string | undefined;

    if (!content) return [];

    // V2 format with parts array
    if (typeof content === 'object' && (content as MastraMessageContentV2).format === 2) {
      const v2 = content as MastraMessageContentV2;
      const parts: Record<string, unknown>[] = [];

      if (v2.parts?.length) {
        return v2.parts as Record<string, unknown>[];
      }

      // Fallback: reconstruct from legacy fields if parts is empty
      if (v2.reasoning) parts.push({ type: 'reasoning', reasoning: v2.reasoning });
      if (v2.toolInvocations?.length) {
        for (const ti of v2.toolInvocations) {
          parts.push({ type: 'tool-invocation', toolInvocation: ti });
        }
      }

      // Text from content field
      if (typeof v2.content === 'string' && v2.content) {
        parts.push({ type: 'text', text: v2.content });
      } else if (Array.isArray(v2.content)) {
        for (const c of v2.content) {
          if (typeof c === 'string') parts.push({ type: 'text', text: c });
          else if ((c as any)?.type === 'text') parts.push({ type: 'text', text: (c as any).text ?? '' });
        }
      }

      return parts;
    }

    // V1 format or plain string
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return [{ type: 'text', text }];
  }
}

// ─── Composite Store ─────────────────────────────────────────────────────────

export class MastraMariaDBStore extends MastraCompositeStore {
  readonly memoryStorage: MariaDBMemoryStorage;

  constructor(pool: ChatPool) {
    super({ id: 'mastra-mariadb', name: 'MastraMariaDBStore', disableInit: false });
    this.memoryStorage = new MariaDBMemoryStorage(pool);
    this.stores = { memory: this.memoryStorage };
  }

  override async init(): Promise<void> {
    await this.memoryStorage.init();
  }
}
