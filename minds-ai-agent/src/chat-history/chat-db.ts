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
  return {
    host: config.get<string>('CHAT_DB_HOST', 'localhost'),
    port: config.get<number>('CHAT_DB_PORT', 3306),
    user: config.get<string>('CHAT_DB_USER', 'root'),
    password: config.get<string>('CHAT_DB_PASSWORD', ''),
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
