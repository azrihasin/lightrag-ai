'use strict';
// Manual mock for the mariadb ESM package — used by Jest (CJS environment)
const mockConnection = {
  query: jest.fn().mockResolvedValue([]),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
};

const mockPool = {
  query: jest.fn().mockResolvedValue([]),
  getConnection: jest.fn().mockResolvedValue(mockConnection),
};

const mariadb = {
  createPool: jest.fn().mockReturnValue(mockPool),
  createConnection: jest.fn().mockResolvedValue(mockConnection),
  __mockPool: mockPool,
  __mockConnection: mockConnection,
};

module.exports = mariadb;
module.exports.default = mariadb;
