import mariadb from 'mariadb';
import { ConfigService } from '@nestjs/config';

export const CHAT_DB_POOL = Symbol('CHAT_DB_POOL');

export type ChatPool = mariadb.Pool;

interface ChatDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

function readChatDbConfig(config: ConfigService): ChatDbConfig {
  // Fall back to MARIADB_* when CHAT_DB_* is unset. An empty CHAT_DB_PASSWORD
  // makes MariaDB offer auth_gssapi_client, which the Node driver does not support.
  return {
    host: config.get<string>('CHAT_DB_HOST') ?? config.get<string>('MARIADB_HOST', 'localhost'),
    port: config.get<number>('CHAT_DB_PORT') ?? config.get<number>('MARIADB_PORT', 3306),
    user: config.get<string>('CHAT_DB_USER') ?? config.get<string>('MARIADB_USER', 'root'),
    password:
      config.get<string>('CHAT_DB_PASSWORD') ?? config.get<string>('MARIADB_PASSWORD', ''),
    database: config.get<string>('CHAT_DB_NAME', 'minds_chat'),
    connectionLimit: config.get<number>('CHAT_DB_CONNECTION_LIMIT', 10),
  };
}

async function ensureDatabaseExists(cfg: ChatDbConfig): Promise<void> {
  const conn = await mariadb.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

export async function createChatDbPool(config: ConfigService): Promise<ChatPool> {
  const cfg = readChatDbConfig(config);
  await ensureDatabaseExists(cfg);
  return mariadb.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit,
    compress: false,
    bigIntAsNumber: true,
  });
}

export async function createChatDbPoolSafe(config: ConfigService): Promise<ChatPool | null> {
  try {
    return await createChatDbPool(config);
  } catch (err) {
    console.warn(
      `[ChatDB] MariaDB unavailable — chat history disabled. Reason: ${(err as Error).message}`,
    );
    return null;
  }
}
