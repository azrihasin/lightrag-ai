import { Module } from '@nestjs/common';
import { MapTilesService } from './map-tiles.service';

/**
 * Indexes the on-disk `map-tiles/WK<week>/<file>.pmtiles` coverage/congestion archives and
 * exposes the manifest to the coverage-map subagent. Static serving of the
 * archives themselves is wired in `main.ts` (range requests).
 */
@Module({
  providers: [MapTilesService],
  exports: [MapTilesService],
})
export class MapTilesModule {}
