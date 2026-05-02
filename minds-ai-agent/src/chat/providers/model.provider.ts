import { Injectable, OnModuleInit } from '@nestjs/common';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { LanguageModel } from 'ai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

@Injectable()
export class ModelProvider implements OnModuleInit {
  private provider: string;
  private modelId: string;

  onModuleInit() {
    this.provider = process.env.AI_PROVIDER ?? 'openai';
    this.modelId = process.env.AI_MODEL ?? (this.provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini');
    console.log(`ModelProvider ready: provider=${this.provider} model=${this.modelId}`);
  }

  getModel(): LanguageModel {
    const provider = process.env.AI_PROVIDER ?? this.provider;
    const modelId = process.env.AI_MODEL ?? this.modelId;
    if (provider === 'anthropic') {
      return anthropic(modelId);
    }
    return openai(modelId);
  }

  getChatModel(tags?: string[]): BaseChatModel {
    const provider = process.env.AI_PROVIDER ?? this.provider;
    const modelId = process.env.AI_MODEL ?? this.modelId;
    if (provider === 'anthropic') {
      return new ChatAnthropic({ model: modelId, tags });
    }
    return new ChatOpenAI({ model: modelId, tags });
  }
}
