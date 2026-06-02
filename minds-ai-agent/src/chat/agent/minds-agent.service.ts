import { Injectable } from '@nestjs/common';
import { MongoDBStore } from '@mastra/mongodb';
import { createMongoDBStore, buildStoreFacade, type MongoDBMemoryStoreFacade } from '../storage/mastra-mongodb.store';

// MindsAgentService owns the shared MongoDB memory store used for chat thread history.
// The actual analytics agent lives in AnalyticsAgentService (analytics.module.ts).
@Injectable()
export class MindsAgentService {
  private readonly mongoStore: MongoDBStore;
  readonly store: MongoDBMemoryStoreFacade;

  constructor() {
    this.mongoStore = createMongoDBStore();
    this.store = buildStoreFacade(this.mongoStore);
  }
}
