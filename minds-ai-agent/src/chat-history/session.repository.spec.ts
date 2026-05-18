import { SessionRepository } from './session.repository';
import { CHAT_DB_POOL } from './chat-db';

function makePool(queryResult: unknown[] = []) {
  return {
    query: jest.fn().mockResolvedValue(queryResult),
  };
}

const BASE_ROW = {
  id: 'sess-1',
  user_id: null,
  title: 'Test Chat',
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  archived_at: null,
  metadata: null,
};

describe('SessionRepository', () => {
  let pool: ReturnType<typeof makePool>;
  let repo: SessionRepository;

  beforeEach(() => {
    pool = makePool();
    repo = new SessionRepository(pool as any);
  });

  describe('create', () => {
    it('inserts a row and returns the created session', async () => {
      pool.query
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([BASE_ROW]); // SELECT

      const session = await repo.create({ userId: 'u1', title: 'Hello' });

      expect(pool.query).toHaveBeenCalledTimes(2);
      const [insertSql, insertParams] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(insertSql).toMatch(/INSERT INTO chat_sessions/i);
      expect(insertParams[1]).toBe('u1');
      expect(insertParams[2]).toBe('Hello');

      expect(session.id).toBe('sess-1');
    });

    it('defaults title to "New Chat" when not provided', async () => {
      pool.query.mockResolvedValue([BASE_ROW]);
      await repo.create({});
      const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe('New Chat');
    });

    it('serialises metadata to JSON string', async () => {
      pool.query.mockResolvedValue([BASE_ROW]);
      await repo.create({ metadata: { foo: 'bar' } });
      const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(params[3]).toBe(JSON.stringify({ foo: 'bar' }));
    });
  });

  describe('list', () => {
    it('filters out archived sessions by default', async () => {
      pool.query.mockResolvedValue([]);
      await repo.list();
      const [sql] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/archived_at IS NULL/i);
    });

    it('includes archived sessions when includeArchived=true', async () => {
      pool.query.mockResolvedValue([]);
      await repo.list({ includeArchived: true });
      const [sql] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/archived_at IS NULL/i);
    });

    it('applies userId filter when provided', async () => {
      pool.query.mockResolvedValue([]);
      await repo.list({ userId: 'user-42' });
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/user_id = \?/i);
      expect(params).toContain('user-42');
    });

    it('uses parameterised limit and offset', async () => {
      pool.query.mockResolvedValue([]);
      await repo.list({ limit: 10, offset: 20 });
      const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(params).toContain(10);
      expect(params).toContain(20);
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      pool.query.mockResolvedValue([]);
      expect(await repo.findById('missing')).toBeNull();
    });

    it('returns mapped session when found', async () => {
      pool.query.mockResolvedValue([BASE_ROW]);
      const result = await repo.findById('sess-1');
      expect(result?.id).toBe('sess-1');
    });
  });

  describe('update', () => {
    it('sets title via parameterised UPDATE', async () => {
      pool.query.mockResolvedValue([]);
      await repo.update('sess-1', { title: 'New Title' });
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/UPDATE chat_sessions SET title = \?/i);
      expect(params[0]).toBe('New Title');
      expect(params[params.length - 1]).toBe('sess-1');
    });

    it('is a no-op when patch is empty', async () => {
      await repo.update('sess-1', {});
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('sets archived_at using parameterised query', async () => {
      pool.query.mockResolvedValue([]);
      await repo.archive('sess-1');
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/UPDATE chat_sessions SET archived_at/i);
      expect(params).toContain('sess-1');
    });
  });
});
