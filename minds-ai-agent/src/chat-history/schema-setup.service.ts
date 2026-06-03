import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CHAT_DB_POOL, type ChatPool } from './chat-db';

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            VARCHAR(36)   NOT NULL,
  user_id       VARCHAR(255),
  title         VARCHAR(500)  NOT NULL DEFAULT 'New Chat',
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  archived_at   DATETIME(3),
  metadata      JSON,
  PRIMARY KEY (id),
  INDEX idx_sessions_user_created (user_id, created_at),
  INDEX idx_sessions_updated (updated_at),
  INDEX idx_sessions_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id                  VARCHAR(36)     NOT NULL,
  session_id          VARCHAR(36)     NOT NULL,
  parent_message_id   VARCHAR(36),
  sequence_index      INT UNSIGNED    NOT NULL,
  role                ENUM('user','assistant','system','agent','tool','thinking') NOT NULL,
  message_type        VARCHAR(50)     NOT NULL DEFAULT 'text',
  content             LONGTEXT        NOT NULL,
  metadata            JSON,
  tool_payload        JSON,
  thinking_payload    JSON,
  model_name          VARCHAR(100),
  input_tokens        INT UNSIGNED,
  output_tokens       INT UNSIGNED,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_messages_session
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_messages_parent
    FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_msg_session_seq    (session_id, sequence_index),
  INDEX idx_msg_session_created (session_id, created_at),
  INDEX idx_msg_updated         (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

@Injectable()
export class SchemaSetupService implements OnModuleInit {
  constructor(
    @InjectPinoLogger(SchemaSetupService.name) private readonly logger: PinoLogger,
    @Inject(CHAT_DB_POOL) private readonly pool: ChatPool | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.pool) {
      this.logger.warn('MariaDB unavailable — chat history schema setup skipped');
      return;
    }

    const statements = SCHEMA_DDL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const conn = await this.pool.getConnection();
    try {
      for (const sql of statements) {
        await conn.query(sql);
      }
      this.logger.info('Chat history schema verified');
    } catch (err) {
      this.logger.error({ err }, 'Chat history schema setup failed');
      throw err;
    } finally {
      conn.release();
    }
  }
}
