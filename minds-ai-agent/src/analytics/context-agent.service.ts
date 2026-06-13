import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { LightragHarnessTool } from '../ai/mastra/tools/lightrag.tool';
import type { RetrievedContext } from './analytics.types';

@Injectable()
export class ContextAgentService {
  constructor(
    @InjectPinoLogger(ContextAgentService.name) private readonly logger: PinoLogger,
    private readonly lightragTool: LightragHarnessTool,
  ) {}

  async retrieveContext(
    schemaQuery: string,
    signal?: AbortSignal,
  ): Promise<RetrievedContext> {
    this.logger.debug({ schemaQuery }, 'Retrieving context from LightRAG');
    const tool = this.lightragTool.asTool();
    // Forward the abort signal so the LightRAG fetch stops the moment the client
    // disconnects, instead of running to completion (and being billed) unseen.
    const result = await (tool.execute as any)(
      { query: schemaQuery, mode: 'mix', topK: 5 },
      { abortSignal: signal },
    );
    return result as RetrievedContext;
  }
}
