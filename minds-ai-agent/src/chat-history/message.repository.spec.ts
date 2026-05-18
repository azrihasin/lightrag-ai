import { MessageRepository } from './message.repository';

function makeConn() {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

function makePool(conn: ReturnType<typeof makeConn>) {
  return {
    getConnection: jest.fn().mockResolvedValue(conn),
    query: jest.fn().mockResolvedValue([{ cnt: 0 }]),
  };
}

describe('MessageRepository', () => {
  let conn: ReturnType<typeof makeConn>;
  let pool: ReturnType<typeof makePool>;
  let repo: MessageRepository;

  beforeEach(() => {
    conn = makeConn();
    pool = makePool(conn);
    repo = new MessageRepository(pool as any);
  });

  describe('insertMany', () => {
    it('wraps inserts in a transaction', async () => {
      conn.query
        .mockResolvedValueOnce([{ max_seq: null }]) // nextSequenceIndex
        .mockResolvedValue([]);

      await repo.insertMany('sess-1', [
        { sequence_index: 0, role: 'user', message_type: 'text', content: 'Hello' },
      ]);

      expect(conn.beginTransaction).toHaveBeenCalled();
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.rollback).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    it('rolls back and rethrows on insert error', async () => {
      conn.query
        .mockResolvedValueOnce([{ max_seq: null }])
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        repo.insertMany('sess-1', [
          { sequence_index: 0, role: 'user', message_type: 'text', content: 'Hello' },
        ]),
      ).rejects.toThrow('DB error');

      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    it('uses parameterised INSERT (no string interpolation)', async () => {
      conn.query
        .mockResolvedValueOnce([{ max_seq: 2 }]) // nextSequenceIndex
        .mockResolvedValue([]);

      await repo.insertMany('sess-1', [
        { sequence_index: 3, role: 'assistant', message_type: 'text', content: 'Hi there' },
      ]);

      const calls = conn.query.mock.calls as [string, unknown[]][];
      const insertCall = calls.find(([sql]) => /INSERT INTO chat_messages/i.test(sql));
      expect(insertCall).toBeDefined();

      const [insertSql, insertParams] = insertCall!;
      // No content value should be embedded in the SQL (parameterised query)
      expect(insertSql).not.toContain('Hi there');
      expect(insertParams).toContain('Hi there');
      expect(insertParams).toContain('sess-1');
      expect(insertParams).toContain('assistant');
    });

    it('skips thinking messages when CHAT_STORE_THINKING is false', async () => {
      const originalEnv = process.env.CHAT_STORE_THINKING;
      process.env.CHAT_STORE_THINKING = 'false';

      conn.query.mockResolvedValueOnce([{ max_seq: null }]).mockResolvedValue([]);

      await repo.insertMany('sess-1', [
        { sequence_index: 0, role: 'thinking', message_type: 'thinking', content: 'internal thought' },
        { sequence_index: 1, role: 'user', message_type: 'text', content: 'actual message' },
      ]);

      const calls = conn.query.mock.calls as [string, unknown[]][];
      const insertCalls = calls.filter(([sql]) => /INSERT INTO chat_messages/i.test(sql));
      // Only the user message should be inserted (thinking skipped)
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0][1]).toContain('actual message');
      expect(insertCalls[0][1]).not.toContain('internal thought');

      process.env.CHAT_STORE_THINKING = originalEnv;
    });

    it('is a no-op for empty message array', async () => {
      await repo.insertMany('sess-1', []);
      expect(conn.beginTransaction).not.toHaveBeenCalled();
    });

    it('auto-increments sequence_index from DB max when provided index is lower', async () => {
      conn.query
        .mockResolvedValueOnce([{ max_seq: 5 }])
        .mockResolvedValue([]);

      await repo.insertMany('sess-1', [
        { sequence_index: 0, role: 'user', message_type: 'text', content: 'msg' },
      ]);

      const calls = conn.query.mock.calls as [string, unknown[]][];
      const insertCall = calls.find(([sql]) => /INSERT INTO chat_messages/i.test(sql));
      // seqIndex should be 6 (max 5 + 1) because provided 0 < nextSeq 6
      expect(insertCall![1][3]).toBe(6);
    });
  });

  describe('countForSession', () => {
    it('returns the count from the DB', async () => {
      pool.query.mockResolvedValue([{ cnt: 7 }]);
      const count = await repo.countForSession('sess-1');
      expect(count).toBe(7);
    });
  });
});
