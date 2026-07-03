import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { FilesModule } from '../files/files.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MindsAgentService } from './agent/minds-agent.service';
import { ModelProvider } from './providers/model.provider';

@Module({
  imports: [AnalyticsModule, FilesModule],
  controllers: [ChatController],
  providers: [
    ModelProvider,
    MindsAgentService,
    ChatService,
  ],
})
export class ChatModule {}
