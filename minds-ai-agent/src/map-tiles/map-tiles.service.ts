import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * One coverage/congestion PMTiles layer available on disk under `map-tiles/`.
 *
 * The generator (Desktop/converter/geojson-to-pmtiles.js) wrote one .pmtiles
 * per source GeoJSON, naming the single MVT source-layer after the sanitized
 * file name — e.g. `minds_TDD_Congestion_WK08_25`. That id is what the frontend
 * protomaps-leaflet paint rules must target, so we capture it here as
 * {@link sourceLayer}.
 */
export interface CoverageLayer {
  /** Stable key the LLM selects, week-independent, e.g. "TDD_Congestion". */
  key: string;
  /** Human label, e.g. "TDD Congestion". */
  label: string;
  /** "coverage" | "congestion" — the two buckets the user asks about. */
  category: 'coverage' | 'congestion';
  /** Week id, e.g. "WK08_25". */
  week: string;
  /** MVT source-layer id inside the .pmtiles (== sanitized file basename). */
  sourceLayer: string;
  /** Absolute URL the browser fetches the archive from (range requests). */
  url: string;
  /** Suggested fill colour for this layer. */
  color: string;
}

export interface WeekManifest {
  week: string;
  /** Sort key (year*100 + weekNo) so "latest" is unambiguous. */
  order: number;
  layers: CoverageLayer[];
}

const PALETTE: Record<string, string> = {
  '5G_Coverage': '#2563eb', // blue
  FDD_Coverage: '#16a34a', // green
  TDD_Coverage: '#0891b2', // cyan
  MOCN_Coverage: '#7c3aed', // violet
  HWC: '#64748b', // slate
  FDD_Congestion: '#dc2626', // red
  TDD_Congestion: '#ea580c', // orange
};

const DEFAULT_COLOR = '#6b7280';

@Injectable()
export class MapTilesService implements OnModuleInit {
  /** Absolute directory holding the per-week `.pmtiles` archives. */
  readonly tilesDir: string;
  /** Public base URL the frontend uses to fetch archives. */
  private readonly baseUrl: string;

  private weeks: WeekManifest[] = [];

  constructor(
    @InjectPinoLogger(MapTilesService.name) private readonly logger: PinoLogger,
  ) {
    this.tilesDir =
      process.env.MAP_TILES_DIR ?? path.join(process.cwd(), 'map-tiles');
    this.baseUrl = (
      process.env.MAP_TILES_BASE_URL ??
      `http://localhost:${process.env.PORT ?? '3001'}/map-tiles`
    ).replace(/\/+$/, '');
  }

  onModuleInit(): void {
    this.scan();
    this.logger.info(
      { weeks: this.weeks.map((w) => w.week), dir: this.tilesDir },
      `MapTilesService indexed ${this.totalLayers()} coverage layer(s)`,
    );
  }

  /** Re-read the directory tree and rebuild the manifest. */
  scan(): void {
    const weeks: WeekManifest[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.tilesDir, { withFileTypes: true });
    } catch {
      this.logger.warn(`map-tiles directory not found: ${this.tilesDir}`);
      this.weeks = [];
      return;
    }

    for (const dir of entries) {
      if (!dir.isDirectory() || !/^WK\d{2}_\d{2}$/i.test(dir.name)) continue;
      const week = dir.name.toUpperCase();
      const weekDir = path.join(this.tilesDir, dir.name);
      const layers: CoverageLayer[] = [];

      for (const file of fs.readdirSync(weekDir)) {
        if (!/\.pmtiles$/i.test(file)) continue;
        const layer = this.parseFile(week, file);
        if (layer) layers.push(layer);
      }

      if (layers.length === 0) continue;
      layers.sort((a, b) => a.label.localeCompare(b.label));
      weeks.push({ week, order: this.weekOrder(week), layers });
    }

    weeks.sort((a, b) => b.order - a.order); // latest first
    this.weeks = weeks;
  }

  /** Parse `minds_<TYPE>_<WEEK>.pmtiles` into a CoverageLayer. */
  private parseFile(week: string, file: string): CoverageLayer | null {
    const base = file.replace(/\.pmtiles$/i, '');
    // Strip the `minds_` prefix and the trailing `_WKxx_yy` to get the type key.
    const typeKey = base
      .replace(/^minds_/i, '')
      .replace(new RegExp(`_${week}$`, 'i'), '');
    if (!typeKey) return null;

    const category: 'coverage' | 'congestion' = /congestion/i.test(typeKey)
      ? 'congestion'
      : 'coverage';

    return {
      key: typeKey,
      label: typeKey.replace(/_/g, ' '),
      category,
      week,
      sourceLayer: base, // converter set source-layer id == sanitized basename
      url: `${this.baseUrl}/${week}/${file}`,
      color: PALETTE[typeKey] ?? DEFAULT_COLOR,
    };
  }

  private weekOrder(week: string): number {
    const m = week.match(/^WK(\d{2})_(\d{2})$/i);
    if (!m) return 0;
    const wk = Number(m[1]);
    const yy = Number(m[2]);
    return (2000 + yy) * 100 + wk;
  }

  private totalLayers(): number {
    return this.weeks.reduce((n, w) => n + w.layers.length, 0);
  }

  // ── Public accessors used by the coverage-map subagent ──────────────────────

  /** All weeks, latest first. */
  getWeeks(): WeekManifest[] {
    return this.weeks;
  }

  /** Week ids only, latest first. */
  getWeekIds(): string[] {
    return this.weeks.map((w) => w.week);
  }

  /** Newest week id, or undefined when nothing is indexed. */
  getLatestWeek(): string | undefined {
    return this.weeks[0]?.week;
  }

  getWeek(week: string): WeekManifest | undefined {
    const w = week.toUpperCase();
    return this.weeks.find((x) => x.week === w);
  }

  /** Distinct layer keys across all weeks (e.g. for prompting the LLM). */
  getLayerKeys(): { key: string; label: string; category: string }[] {
    const seen = new Map<string, { key: string; label: string; category: string }>();
    for (const w of this.weeks) {
      for (const l of w.layers) {
        if (!seen.has(l.key)) {
          seen.set(l.key, { key: l.key, label: l.label, category: l.category });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Union geographic bounds of the given layers, read from each PMTiles v3
   * header (bytes 102-117, int32 E7). Returns [minLng, minLat, maxLng, maxLat]
   * or undefined if nothing could be read.
   */
  unionBounds(layers: CoverageLayer[]): [number, number, number, number] | undefined {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const layer of layers) {
      const file = path.join(this.tilesDir, layer.week, path.basename(layer.url));
      try {
        const fd = fs.openSync(file, 'r');
        try {
          const head = Buffer.alloc(127);
          fs.readSync(fd, head, 0, 127, 0);
          const a = head.readInt32LE(102) / 1e7;
          const b = head.readInt32LE(106) / 1e7;
          const c = head.readInt32LE(110) / 1e7;
          const d = head.readInt32LE(114) / 1e7;
          if (a < minLng) minLng = a;
          if (b < minLat) minLat = b;
          if (c > maxLng) maxLng = c;
          if (d > maxLat) maxLat = d;
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        // ignore unreadable archives
      }
    }
    if (!isFinite(minLng)) return undefined;
    return [minLng, minLat, maxLng, maxLat];
  }

  /**
   * Resolve a set of requested layer keys for a given week into concrete
   * CoverageLayer descriptors. Unknown keys and keys missing for that week are
   * skipped. When `keys` is empty, returns every layer for the week.
   */
  resolveLayers(week: string, keys?: string[], category?: 'coverage' | 'congestion'): CoverageLayer[] {
    const manifest = this.getWeek(week);
    if (!manifest) return [];

    let pool = manifest.layers;
    if (category) pool = pool.filter((l) => l.category === category);

    if (!keys || keys.length === 0) return pool;

    const wanted = new Set(keys.map((k) => k.toLowerCase()));
    return pool.filter(
      (l) => wanted.has(l.key.toLowerCase()) || wanted.has(l.label.toLowerCase()),
    );
  }
}
