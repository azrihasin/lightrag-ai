import { Global, Module } from '@nestjs/common';
import { DuckdbService } from './duckdb.service';

/**
 * Provides the shared DuckDB instance (read-only attached to MariaDB). Global so
 * the analytics schema/plan/profile/viz services can inject `DuckdbService`
 * without re-importing this module everywhere.
 */
@Global()
@Module({
  providers: [DuckdbService],
  exports: [DuckdbService],
})
export class DuckdbModule {}
