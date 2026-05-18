import { ConfigService } from '@nestjs/config';

jest.mock('mariadb', () => {
  const mockConn = {
    query: jest.fn().mockResolvedValue([]),
    end: jest.fn().mockResolvedValue(undefined),
  };
  return {
    createConnection: jest.fn().mockResolvedValue(mockConn),
    createPool: jest.fn().mockReturnValue({ query: jest.fn() }),
    __mockConn: mockConn,
  };
});

import mariadb from 'mariadb';
import { createChatDbPool } from './chat-db';

const mockMariadb = mariadb as any;

describe('createChatDbPool', () => {
  let config: ConfigService;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string, def: unknown) => {
        const values: Record<string, unknown> = {
          CHAT_DB_HOST: 'db-host',
          CHAT_DB_PORT: 5432,
          CHAT_DB_USER: 'test-user',
          CHAT_DB_PASSWORD: 'secret',
          CHAT_DB_NAME: 'test_chat',
          CHAT_DB_CONNECTION_LIMIT: 5,
        };
        return values[key] ?? def;
      }),
    } as unknown as ConfigService;
  });

  it('creates a temporary connection to ensure the database exists', async () => {
    await createChatDbPool(config);
    expect(mockMariadb.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db-host', user: 'test-user', password: 'secret' }),
    );
    // The temporary connection must NOT include the database name (so CREATE DATABASE can succeed)
    const connArgs = mockMariadb.createConnection.mock.calls[0][0];
    expect(connArgs.database).toBeUndefined();
  });

  it('runs CREATE DATABASE IF NOT EXISTS with backtick-quoted name', async () => {
    await createChatDbPool(config);
    const { query } = mockMariadb.__mockConn;
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE DATABASE IF NOT EXISTS `test_chat`'),
    );
  });

  it('closes the temporary connection after schema setup', async () => {
    await createChatDbPool(config);
    expect(mockMariadb.__mockConn.end).toHaveBeenCalled();
  });

  it('creates a pool with the correct config', async () => {
    await createChatDbPool(config);
    expect(mockMariadb.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'db-host',
        user: 'test-user',
        database: 'test_chat',
        connectionLimit: 5,
      }),
    );
  });
});
