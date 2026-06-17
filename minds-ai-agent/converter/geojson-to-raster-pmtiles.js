#!/usr/bin/env node
/**
 * geojson-to-raster-pmtiles.js — Pure Node.js, Windows-native (no WSL/Docker/GDAL).
 *
 * RASTER counterpart to geojson-to-pmtiles.js. Instead of encoding vector MVT
 * tiles, it RASTERIZES every .geojson under a coverage directory into 256x256
 * PNG tiles and packages them as a *raster* PMTiles v3 archive (tile type PNG).
 *
 * Pipeline:
 *   geojson-vt (clip features per web-mercator tile, in extent space)
 *     -> @napi-rs/canvas (draw + fill polygons -> RGBA PNG)
 *     -> PMTiles v3 archive (PNG tile type, tiles stored uncompressed).
 *
 * PMTiles spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 *
 * ---------------------------------------------------------------------------
 * ONE-TIME SETUP (no admin rights needed):
 *
 *   cd "C:\Users\C00570\Desktop\converter"
 *   npm install geojson-vt @napi-rs/canvas
 *
 * RUN:
 *   node "C:\Users\C00570\Desktop\converter\geojson-to-raster-pmtiles.js"
 *   node "C:\Users\C00570\Desktop\converter\geojson-to-raster-pmtiles.js" <inputDir> <outputDir>
 * ---------------------------------------------------------------------------
 *
 * Input layout (one folder per week, many geojson per week):
 *   coverage/WK08_25/minds_5G_Coverage_WK08_25.geojson ...
 * Output mirrors the tree:
 *   raster-pmtiles/WK08_25/minds_5G_Coverage_WK08_25.pmtiles ...
 *
 * Each source file has empty feature `properties`, so colour is decided per
 * file (per coverage/congestion type) from PALETTE below — matching the
 * frontend/backend palette (minds-ai-agent/src/map-tiles/map-tiles.service.ts).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------------------
// Re-exec with a large heap so the 300+ MB GeoJSON files can be parsed.
// ---------------------------------------------------------------------------
if (!process.env.__RPMTILES_REEXEC) {
  const r = spawnSync(
    process.execPath,
    ["--max-old-space-size=8192", __filename, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, __RPMTILES_REEXEC: "1" } }
  );
  process.exit(r.status === null ? 1 : r.status);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INPUT_DIR =
  process.argv[2] ||
  "C:\\Users\\C00570\\Desktop\\lightrag-ai\\minds-ai-agent\\coverage";
const OUTPUT_DIR = process.argv[3] || "C:\\Users\\C00570\\Desktop\\raster-pmtiles";

const MINZOOM = 0;
const MAXZOOM = 12; // raise for more detail (many more tiles / memory / time)
const TILE_SIZE = 256; // PNG tile edge in px (standard web-map tile)
const EXTENT = 4096; // geojson-vt coordinate extent per tile
const OVERWRITE = true;

const FILL_ALPHA = 0.5; // baked-in fill transparency so a basemap shows through
const STROKE_ALPHA = 0.9; // polygon outline opacity
const STROKE_WIDTH = 0.6; // outline width in px

// Per-type colours (mirror map-tiles.service.ts PALETTE). Keyed by the type
// token derived from the file name (e.g. "5G_Coverage", "FDD_Congestion").
const PALETTE = {
  "5G_Coverage": "#2563eb", // blue
  FDD_Coverage: "#16a34a", // green
  TDD_Coverage: "#0891b2", // cyan
  MOCN_Coverage: "#7c3aed", // violet
  HWC: "#64748b", // slate
  FDD_Congestion: "#dc2626", // red
  TDD_Congestion: "#ea580c", // orange
};
const DEFAULT_COLOR = "#6b7280";

// geojson-vt tiling options (good defaults for coverage polygons).
const GEOJSON_VT_OPTS = {
  maxZoom: MAXZOOM,
  indexMaxZoom: 5,
  indexMaxPoints: 100000,
  tolerance: 3,
  extent: EXTENT,
  buffer: 64, // render slightly past the tile edge to avoid seams
  generateId: false,
};

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------
let geojsonvt, canvasMod;
try {
  geojsonvt = require("geojson-vt");
  canvasMod = require("@napi-rs/canvas");
} catch (e) {
  console.error("\nMissing dependencies. Install them first:\n");
  console.error('  cd "C:\\Users\\C00570\\Desktop\\converter"');
  console.error("  npm install geojson-vt @napi-rs/canvas\n");
  console.error(String((e && e.message) || e));
  process.exit(1);
}
geojsonvt = geojsonvt.default || geojsonvt;
const { createCanvas } = canvasMod;

// ---------------------------------------------------------------------------
// Varint (LEB128) — uses division so it is safe past 2^32 (up to 2^53).
// ---------------------------------------------------------------------------
function writeVarint(bytes, value) {
  while (value >= 128) {
    bytes.push((value % 128) + 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
}

// ---------------------------------------------------------------------------
// Hilbert ZXY -> tile id  (PMTiles ordering)
// ---------------------------------------------------------------------------
function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += Math.pow(4, t);
  const n = 1 << z;
  let rx,
    ry,
    d = 0,
    tx = x,
    ty = y;
  for (let s = n >> 1; s > 0; s = s >> 1) {
    rx = (tx & s) > 0 ? 1 : 0;
    ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const tmp = tx;
      tx = ty;
      ty = tmp;
    }
  }
  return acc + d;
}

// ---------------------------------------------------------------------------
// Directory serialization (PMTiles v3) + gzip (directories/metadata only)
// ---------------------------------------------------------------------------
function serializeDirectory(entries) {
  const bytes = [];
  writeVarint(bytes, entries.length);

  let last = 0;
  for (const e of entries) {
    writeVarint(bytes, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(bytes, e.runLength);
  for (const e of entries) writeVarint(bytes, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) {
      writeVarint(bytes, 0);
    } else {
      writeVarint(bytes, e.offset + 1);
    }
  }
  return Buffer.from(bytes);
}

const gzip = (buf) => zlib.gzipSync(buf);

// ---------------------------------------------------------------------------
// Tile (z/x/y) -> geographic extent (Web Mercator), for bbox-based descent.
// ---------------------------------------------------------------------------
function tileLon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function tileIntersectsBBox(z, x, y, bbox) {
  const west = tileLon(x, z);
  const east = tileLon(x + 1, z);
  const north = tileLat(y, z);
  const south = tileLat(y + 1, z);
  return !(east < bbox[0] || west > bbox[2] || north < bbox[1] || south > bbox[3]);
}

const ROOT_MAX = 16384 - 127; // root dir must share the first 16 KiB with the header

function buildDirectories(entries) {
  const rootOnly = gzip(serializeDirectory(entries));
  if (rootOnly.length <= ROOT_MAX) {
    return { root: rootOnly, leaves: Buffer.alloc(0), numLeaves: 0 };
  }
  let leafSize = Math.max(4096, Math.ceil(entries.length / 3500));
  for (;;) {
    const rootEntries = [];
    const leafBufs = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const leaf = gzip(serializeDirectory(chunk));
      rootEntries.push({
        tileId: chunk[0].tileId,
        offset: leafOffset,
        length: leaf.length,
        runLength: 0, // 0 runLength => pointer to a leaf directory
      });
      leafBufs.push(leaf);
      leafOffset += leaf.length;
    }
    const root = gzip(serializeDirectory(rootEntries));
    if (root.length <= ROOT_MAX) {
      return { root, leaves: Buffer.concat(leafBufs), numLeaves: rootEntries.length };
    }
    leafSize = Math.ceil(leafSize * 1.4);
  }
}

// ---------------------------------------------------------------------------
// 127-byte header
// ---------------------------------------------------------------------------
function buildHeader(s) {
  const h = Buffer.alloc(127);
  h.write("PMTiles", 0, "ascii");
  h.writeUInt8(3, 7); // spec version
  h.writeBigUInt64LE(BigInt(s.rootOffset), 8);
  h.writeBigUInt64LE(BigInt(s.rootLength), 16);
  h.writeBigUInt64LE(BigInt(s.metaOffset), 24);
  h.writeBigUInt64LE(BigInt(s.metaLength), 32);
  h.writeBigUInt64LE(BigInt(s.leafOffset), 40);
  h.writeBigUInt64LE(BigInt(s.leafLength), 48);
  h.writeBigUInt64LE(BigInt(s.tileOffset), 56);
  h.writeBigUInt64LE(BigInt(s.tileLength), 64);
  h.writeBigUInt64LE(BigInt(s.numAddressed), 72);
  h.writeBigUInt64LE(BigInt(s.numEntries), 80);
  h.writeBigUInt64LE(BigInt(s.numContents), 88);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(2, 97); // internal compression: gzip (directories + metadata)
  h.writeUInt8(1, 98); // tile compression: NONE (PNG is already compressed)
  h.writeUInt8(2, 99); // tile type: PNG  (1=MVT,2=PNG,3=JPEG,4=WEBP,5=AVIF)
  h.writeUInt8(s.minZoom, 100);
  h.writeUInt8(s.maxZoom, 101);
  h.writeInt32LE(s.minLonE7, 102);
  h.writeInt32LE(s.minLatE7, 106);
  h.writeInt32LE(s.maxLonE7, 110);
  h.writeInt32LE(s.maxLatE7, 114);
  h.writeUInt8(s.centerZoom, 118);
  h.writeInt32LE(s.centerLonE7, 119);
  h.writeInt32LE(s.centerLatE7, 123);
  return h;
}

// ---------------------------------------------------------------------------
// File discovery + bbox + colour
// ---------------------------------------------------------------------------
function findGeojson(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findGeojson(full));
    else if (entry.isFile() && /\.geojson$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function layerName(p) {
  return path.basename(p, path.extname(p)).replace(/[^a-zA-Z0-9_]/g, "_");
}

// Derive the PALETTE type key from a file name, matching the backend:
// strip `minds_` prefix and a trailing `_WKxx_yy` week token.
function typeKeyFromFile(p) {
  return path
    .basename(p, path.extname(p))
    .replace(/^minds_/i, "")
    .replace(/_WK\d{2}_\d{2}$/i, "");
}

// "#rrggbb" -> {r,g,b}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 107, g: 114, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function accumulateBBox(bbox, feature) {
  const apply = (lon, lat) => {
    if (lon < bbox[0]) bbox[0] = lon;
    if (lat < bbox[1]) bbox[1] = lat;
    if (lon > bbox[2]) bbox[2] = lon;
    if (lat > bbox[3]) bbox[3] = lat;
  };
  if (Array.isArray(feature.bbox) && feature.bbox.length >= 4) {
    apply(feature.bbox[0], feature.bbox[1]);
    apply(feature.bbox[2], feature.bbox[3]);
    return;
  }
  const walk = (c) => {
    if (typeof c[0] === "number") apply(c[0], c[1]);
    else for (const sub of c) walk(sub);
  };
  if (feature.geometry && feature.geometry.coordinates) {
    walk(feature.geometry.coordinates);
  }
}

// ---------------------------------------------------------------------------
// Rasterize one geojson-vt tile to a 256x256 PNG buffer.
//
// geojson-vt tile features (v4):
//   feature.type: 1=Point, 2=LineString, 3=Polygon
//   feature.geometry:
//     - polygons: array of rings; each ring is an array of [x,y] pairs in
//       extent space. Exterior and hole rings have opposite winding, so a
//       single Path2D filled with the nonzero rule renders holes correctly.
//     - lines: array of lines; each an array of [x,y].
//     - points: array of [x,y].
// Returns a PNG Buffer, or null if nothing was drawn.
// ---------------------------------------------------------------------------
function rasterizeTile(tile, rgb) {
  const scale = TILE_SIZE / EXTENT;
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${FILL_ALPHA})`;
  ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${STROKE_ALPHA})`;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineJoin = "round";

  let drew = false;

  for (const f of tile.features) {
    const g = f.geometry;
    if (f.type === 3) {
      // Polygon / MultiPolygon: one path, nonzero fill handles holes.
      const path2d = new (canvasMod.Path2D)();
      for (const ring of g) {
        if (ring.length < 3) continue;
        path2d.moveTo(ring[0][0] * scale, ring[0][1] * scale);
        for (let i = 1; i < ring.length; i++) {
          path2d.lineTo(ring[i][0] * scale, ring[i][1] * scale);
        }
        path2d.closePath();
      }
      ctx.fill(path2d, "nonzero");
      if (STROKE_WIDTH > 0) ctx.stroke(path2d);
      drew = true;
    } else if (f.type === 2) {
      // LineString / MultiLineString
      for (const line of g) {
        if (line.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(line[0][0] * scale, line[0][1] * scale);
        for (let i = 1; i < line.length; i++) {
          ctx.lineTo(line[i][0] * scale, line[i][1] * scale);
        }
        ctx.stroke();
        drew = true;
      }
    } else if (f.type === 1) {
      // Points: small filled dots.
      for (const pt of g) {
        ctx.beginPath();
        ctx.arc(pt[0] * scale, pt[1] * scale, 2, 0, Math.PI * 2);
        ctx.fill();
        drew = true;
      }
    }
  }

  if (!drew) return null;
  return canvas.encode ? canvas.encode("png") : canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Convert one GeoJSON file -> raster PMTiles
// ---------------------------------------------------------------------------
function convertFile(inputWin, outputWin) {
  const layer = layerName(inputWin);
  const rgb = hexToRgb(PALETTE[typeKeyFromFile(inputWin)] || DEFAULT_COLOR);

  const raw = fs.readFileSync(inputWin, "utf8");
  const geojson = JSON.parse(raw);

  const features = geojson.features || (geojson.type === "Feature" ? [geojson] : []);
  if (features.length === 0) {
    console.log("    (no features) — skipped");
    return false;
  }

  // Overall bounds (used for header + descent pruning).
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) accumulateBBox(bbox, f);
  if (!isFinite(bbox[0])) {
    bbox[0] = -180;
    bbox[1] = -85.0511;
    bbox[2] = 180;
    bbox[3] = 85.0511;
  }

  const tileIndex = geojsonvt(geojson, GEOJSON_VT_OPTS);

  // Descend the tile pyramid, rasterizing only non-empty tiles. Prune on
  // geographic overlap with the data bbox (not parent emptiness): tiny features
  // can simplify away at low zoom yet reappear at z10-12.
  const tilesById = new Map(); // tileId -> PNG buffer (await-able promises resolved below)
  const pending = [];
  let addressed = 0;

  function descend(z, x, y) {
    if (!tileIntersectsBBox(z, x, y, bbox)) return;

    const tile = tileIndex.getTile(z, x, y);
    if (tile && tile.features && tile.features.length > 0) {
      const png = rasterizeTile(tile, rgb);
      if (png) {
        const id = zxyToTileId(z, x, y);
        if (png.then) {
          pending.push(png.then((buf) => tilesById.set(id, buf)));
        } else {
          tilesById.set(id, png);
        }
        addressed++;
      }
    }
    if (z < MAXZOOM) {
      descend(z + 1, x * 2, y * 2);
      descend(z + 1, x * 2 + 1, y * 2);
      descend(z + 1, x * 2, y * 2 + 1);
      descend(z + 1, x * 2 + 1, y * 2 + 1);
    }
  }
  descend(0, 0, 0);

  return Promise.all(pending).then(() => finishFile(outputWin, tilesById, addressed, bbox, layer));
}

function finishFile(outputWin, tilesById, addressed, bbox, layer) {
  if (tilesById.size === 0) {
    console.log("    (produced no tiles) — skipped");
    return false;
  }

  // Entries in tileId order with sequential offsets. Identical adjacent PNGs
  // (common for solid tiles) are deduped via run-length encoding.
  const sortedIds = [...tilesById.keys()].sort((a, b) => a - b);
  const entries = [];
  const tileBufs = [];
  let offset = 0;
  let lastHash = null;
  let numContents = 0;

  for (const id of sortedIds) {
    const buf = tilesById.get(id);
    const last = entries[entries.length - 1];
    // Run-length: same bytes as the previous, contiguous tile id -> extend run.
    if (
      last &&
      lastHash !== null &&
      buf.length === last.length &&
      id === last.tileId + last.runLength &&
      buf.equals(tileBufs[tileBufs.length - 1])
    ) {
      last.runLength++;
      continue;
    }
    entries.push({ tileId: id, offset, length: buf.length, runLength: 1 });
    tileBufs.push(buf);
    offset += buf.length;
    numContents++;
    lastHash = id;
  }
  const tileData = Buffer.concat(tileBufs);

  const { root, leaves } = buildDirectories(entries);

  const metadata = gzip(
    Buffer.from(
      JSON.stringify({
        name: layer,
        format: "png",
        type: "overlay",
        minzoom: MINZOOM,
        maxzoom: MAXZOOM,
        bounds: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
        center: `${(bbox[0] + bbox[2]) / 2},${(bbox[1] + bbox[3]) / 2},${MINZOOM}`,
      })
    )
  );

  // Layout: [header 127][root][metadata][leaves][tiles]
  const rootOffset = 127;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + metadata.length;
  const tileOffset = leafOffset + leaves.length;

  const e7 = (d) => Math.round(d * 1e7);
  const header = buildHeader({
    rootOffset,
    rootLength: root.length,
    metaOffset,
    metaLength: metadata.length,
    leafOffset,
    leafLength: leaves.length,
    tileOffset,
    tileLength: tileData.length,
    numAddressed: addressed,
    numEntries: entries.length,
    numContents,
    minZoom: MINZOOM,
    maxZoom: MAXZOOM,
    minLonE7: e7(bbox[0]),
    minLatE7: e7(bbox[1]),
    maxLonE7: e7(bbox[2]),
    maxLatE7: e7(bbox[3]),
    centerZoom: MINZOOM,
    centerLonE7: e7((bbox[0] + bbox[2]) / 2),
    centerLatE7: e7((bbox[1] + bbox[3]) / 2),
  });

  fs.mkdirSync(path.dirname(outputWin), { recursive: true });
  const out = fs.openSync(outputWin, "w");
  try {
    fs.writeSync(out, header);
    fs.writeSync(out, root);
    fs.writeSync(out, metadata);
    if (leaves.length) fs.writeSync(out, leaves);
    fs.writeSync(out, tileData);
  } finally {
    fs.closeSync(out);
  }

  console.log(
    `    ${addressed} tiles (${entries.length} entries), z${MINZOOM}-${MAXZOOM}, ${(
      fs.statSync(outputWin).size /
      1024 /
      1024
    ).toFixed(1)} MB`
  );
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  const files = findGeojson(INPUT_DIR);
  if (files.length === 0) {
    console.error(`No .geojson files found under ${INPUT_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} GeoJSON file(s).`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Zoom:   ${MINZOOM}-${MAXZOOM}  Tile: ${TILE_SIZE}px PNG\n`);

  let ok = 0,
    failed = 0,
    skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const inputWin = files[i];
    const rel = path.relative(INPUT_DIR, inputWin);
    const outputWin = path.join(OUTPUT_DIR, rel.replace(/\.geojson$/i, ".pmtiles"));
    const label = `[${i + 1}/${files.length}] ${rel}`;

    if (!OVERWRITE && fs.existsSync(outputWin)) {
      console.log(`${label} -> SKIP (exists)`);
      skipped++;
      continue;
    }

    const started = Date.now();
    console.log(`${label}`);
    try {
      const produced = await convertFile(inputWin, outputWin);
      if (produced) {
        console.log(`    done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
        ok++;
      } else {
        skipped++;
        console.log("");
      }
    } catch (err) {
      console.error(`    ERROR: ${err && err.message ? err.message : err}\n`);
      failed++;
    }
  }

  console.log("------------------------------------------------------------");
  console.log(`Done. ${ok} converted, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
