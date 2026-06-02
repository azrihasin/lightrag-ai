import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MindsAgentService } from './agent/minds-agent.service';
import { ModelProvider } from './providers/model.provider';

@Module({
  imports: [AnalyticsModule],
  controllers: [ChatController],
  providers: [
    ModelProvider,
    MindsAgentService,
    ChatService,
  ],
})
export class ChatModule {}
