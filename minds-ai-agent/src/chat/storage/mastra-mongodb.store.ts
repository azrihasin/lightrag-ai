import { MongoDBStore } from '@mastra/mongodb';
import type { MemoryStorage } from '@mastra/core/storage';

export type { MemoryStorage };

export function createMongoDBStore(): MongoDBStore {
  return new MongoDBStore({
    id: 'mongodb-storage-01',
    uri: 'mongodb://localhost:27017',
    dbName: 'minds',
  });
}

export type MongoDBMemoryStoreFacade = {
  memoryStorage: MemoryStorage;
};

export function buildStoreFacade(store: MongoDBStore): MongoDBMemoryStoreFacade {
  return {
    memoryStorage: store.stores.memory!,
  };
}
