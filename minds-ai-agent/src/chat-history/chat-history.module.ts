import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_DB_POOL, createChatDbPool } from './chat-db';
import { SchemaSetupService } from './schema-setup.service';
import { SessionRepository } from './session.repository';
import { MessageRepository } from './message.repository';
import { ChatHistoryService } from './chat-history.service';
import { ChatHistoryController } from './chat-history.controller';

@Module({
  controllers: [ChatHistoryController],
  providers: [
    {
      provide: CHAT_DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createChatDbPool(config),
    },
    SchemaSetupService,
    SessionRepository,
    MessageRepository,
    ChatHistoryService,
  ],
  exports: [ChatHistoryService, CHAT_DB_POOL],
})
export class ChatHistoryModule {}
