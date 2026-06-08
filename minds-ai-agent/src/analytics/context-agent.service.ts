import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { LancedbRetrievalTool } from '../ai/mastra/tools/lancedb-retrieve.tool';
import type { RetrievedContext } from './analytics.types';

@Injectable()
export class ContextAgentService {
  constructor(
    @InjectPinoLogger(ContextAgentService.name) private readonly logger: PinoLogger,
    private readonly retrievalTool: LancedbRetrievalTool,
  ) {}

  async retrieveContext(
    schemaQuery: string,
    signal?: AbortSignal,
  ): Promise<RetrievedContext> {
    this.logger.debug({ schemaQuery }, 'Retrieving context from LanceDB');
    const tool = this.retrievalTool.asTool();
    // Forward the abort signal so retrieval stops the moment the client
    // disconnects, instead of running to completion unseen.
    const result = await (tool.execute as any)(
      { query: schemaQuery, topK: 5 },
      { abortSignal: signal },
    );
    return result as RetrievedContext;
  }
}
