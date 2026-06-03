import { Injectable } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

@Injectable()
export class ModelProvider {
  private readonly modelId: string;
  private readonly baseURL: string;

  constructor() {
    const modelId = process.env.AI_MODEL;
    if (!modelId) {
      throw new Error('AI_MODEL environment variable is required (no default fallback)');
    }
    this.modelId = modelId;
    this.baseURL = process.env.LLM_BINDING_HOST ?? 'https://api.openai.com/v1';
    console.log(`ModelProvider ready: model=${this.modelId} baseURL=${this.baseURL}`);
  }

  /**
   * True for providers that do not support response_format: json_schema
   * (e.g. DeepSeek). When true, agents should use jsonPromptInjection for
   * structured output so Mastra falls back to prompt-based JSON coercion.
   */
  get needsJsonPromptInjection(): boolean {
    return this.baseURL.includes('deepseek.com') || this.modelId.startsWith('deepseek');
  }

  getModel(): LanguageModel {
    const openaiProvider = createOpenAI({
      baseURL: this.baseURL,
      apiKey: process.env.OPENAI_API_KEY,
    });

    return this.needsJsonPromptInjection
      ? openaiProvider.chat(this.modelId)
      : openaiProvider(this.modelId);
  }
}
