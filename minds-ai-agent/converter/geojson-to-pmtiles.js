#!/usr/bin/env node
/**
 * geojson-to-pmtiles.js  —  Pure Node.js, Windows-native (no WSL/Docker/tippecanoe).
 *
 * Converts every .geojson under a coverage directory into a .pmtiles file.
 * Pipeline:  geojson-vt (tiling)  ->  vt-pbf (MVT encode)  ->  gzip  ->  PMTiles v3 archive.
 * PMTiles spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 *
 * ---------------------------------------------------------------------------
 * ONE-TIME SETUP (no admin rights needed):
 *
 *   cd "C:\Users\C00570\Desktop"
 *   npm init -y
 *   npm install geojson-vt vt-pbf
 *
 * RUN:
 *   node "C:\Users\C00570\Desktop\geojson-to-pmtiles.js"
 *   node "C:\Users\C00570\Desktop\geojson-to-pmtiles.js" <inputDir> <outputDir>
 * ---------------------------------------------------------------------------
 *
 * Input layout (one folder per week, many geojson per week):
 *   coverage/WK08_25/minds_5G_Coverage_WK08_25.geojson ...
 * Output mirrors the tree:
 *   pmtiles/WK08_25/minds_5G_Coverage_WK08_25.pmtiles ...
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------------------
// Re-exec with a large heap so the 300+ MB GeoJSON files can be parsed.
// ---------------------------------------------------------------------------
if (!process.env.__PMTILES_REEXEC) {
  const r = spawnSync(
    process.execPath,
    ["--max-old-space-size=8192", __filename, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, __PMTILES_REEXEC: "1" } }
  );
  process.exit(r.status === null ? 1 : r.status);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INPUT_DIR =
  process.argv[2] ||
  "C:\\Users\\C00570\\Desktop\\lightrag-ai\\minds-ai-agent\\coverage";
const OUTPUT_DIR = process.argv[3] || "C:\\Users\\C00570\\Desktop\\pmtiles";

const MINZOOM = 0;
const MAXZOOM = 12; // raise to 14 for more detail (more tiles / memory / time)
const OVERWRITE = true;

// geojson-vt tiling options (good defaults for coverage polygons)
const GEOJSON_VT_OPTS = {
  maxZoom: MAXZOOM, // max zoom getTile() will generate to
  indexMaxZoom: 5, // initial index depth
  indexMaxPoints: 100000,
  tolerance: 3, // simplification at max zoom (px)
  extent: 4096,
  buffer: 64,
  generateId: false,
};

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------
let geojsonvt, vtpbf;
try {
  geojsonvt = require("geojson-vt");
  vtpbf = require("vt-pbf");
} catch (e) {
  console.error("\nMissing dependencies. Install them first:\n");
  console.error('  cd "C:\\Users\\C00570\\Desktop"');
  console.error("  npm init -y");
  console.error("  npm install geojson-vt vt-pbf\n");
  process.exit(1);
}
// geojson-vt may export as default depending on version
geojsonvt = geojsonvt.default || geojsonvt;

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
  // base = (4^z - 1) / 3 , accumulated to avoid precision issues
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
    // rotate
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
// Directory serialization (PMTiles v3) + gzip
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
// Does tile z/x/y overlap the data bbox [minLon,minLat,maxLon,maxLat]?
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
  // Split into leaf directories.
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
  h.writeUInt8(2, 97); // internal compression: gzip
  h.writeUInt8(2, 98); // tile compression: gzip
  h.writeUInt8(1, 99); // tile type: MVT
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
// File discovery + bbox
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

// Accumulate bbox using feature.bbox when present (these files have it),
// else from the geometry coordinates.
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
// Convert one GeoJSON file
// ---------------------------------------------------------------------------
function convertFile(inputWin, outputWin) {
  const layer = layerName(inputWin);

  const raw = fs.readFileSync(inputWin, "utf8");
  const geojson = JSON.parse(raw);

  const features = geojson.features || (geojson.type === "Feature" ? [geojson] : []);
  if (features.length === 0) {
    console.log("    (no features) — skipped");
    return false;
  }

  // Overall bounds + property field names for metadata.
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const fields = {};
  for (const f of features) {
    accumulateBBox(bbox, f);
    if (f.properties) {
      for (const k of Object.keys(f.properties)) {
        if (!(k in fields)) {
          const v = f.properties[k];
          fields[k] =
            typeof v === "number"
              ? "Number"
              : typeof v === "boolean"
              ? "Boolean"
              : "String";
        }
      }
    }
  }
  if (!isFinite(bbox[0])) {
    bbox[0] = -180;
    bbox[1] = -85.0511;
    bbox[2] = 180;
    bbox[3] = 85.0511;
  }

  const tileIndex = geojsonvt(geojson, GEOJSON_VT_OPTS);

  // Descend the tile pyramid, encoding only non-empty tiles.
  //
  // Prune on whether a tile geographically OVERLAPS the data bbox, NOT on
  // whether the parent tile rendered features. Small features (e.g. ~40 m
  // congestion polygons) simplify away at low zoom, so a parent tile can be
  // empty while its descendants at z10-12 are not — pruning on emptiness
  // would drop those whole datasets.
  const tilesById = new Map(); // tileId -> gzipped MVT buffer
  let addressed = 0;

  function descend(z, x, y) {
    if (!tileIntersectsBBox(z, x, y, bbox)) return;

    const tile = tileIndex.getTile(z, x, y);
    if (tile && tile.features && tile.features.length > 0) {
      const mvt = vtpbf.fromGeojsonVt({ [layer]: tile }, { version: 2 });
      if (mvt && mvt.length > 0) {
        tilesById.set(zxyToTileId(z, x, y), gzip(Buffer.from(mvt)));
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

  if (tilesById.size === 0) {
    console.log("    (produced no tiles) — skipped");
    return false;
  }

  // Build entries in tileId order, assigning sequential offsets.
  const sortedIds = [...tilesById.keys()].sort((a, b) => a - b);
  const entries = [];
  const tileBufs = [];
  let offset = 0;
  for (const id of sortedIds) {
    const buf = tilesById.get(id);
    entries.push({ tileId: id, offset, length: buf.length, runLength: 1 });
    tileBufs.push(buf);
    offset += buf.length;
  }
  const tileData = Buffer.concat(tileBufs);

  const { root, leaves } = buildDirectories(entries);

  const metadata = gzip(
    Buffer.from(
      JSON.stringify({
        name: layer,
        format: "pbf",
        type: "overlay",
        minzoom: MINZOOM,
        maxzoom: MAXZOOM,
        bounds: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
        center: `${(bbox[0] + bbox[2]) / 2},${(bbox[1] + bbox[3]) / 2},${MINZOOM}`,
        vector_layers: [{ id: layer, fields, minzoom: MINZOOM, maxzoom: MAXZOOM }],
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
    numContents: entries.length,
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
    `    ${entries.length} tiles, z${MINZOOM}-${MAXZOOM}, ${(
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
function main() {
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
  console.log(`Zoom:   ${MINZOOM}-${MAXZOOM}\n`);

  let ok = 0,
    failed = 0,
    skipped = 0;

  files.forEach((inputWin, i) => {
    const rel = path.relative(INPUT_DIR, inputWin);
    const outputWin = path.join(OUTPUT_DIR, rel.replace(/\.geojson$/i, ".pmtiles"));
    const label = `[${i + 1}/${files.length}] ${rel}`;

    if (!OVERWRITE && fs.existsSync(outputWin)) {
      console.log(`${label} -> SKIP (exists)`);
      skipped++;
      return;
    }

    const started = Date.now();
    console.log(`${label}`);
    try {
      const produced = convertFile(inputWin, outputWin);
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
  });

  console.log("------------------------------------------------------------");
  console.log(`Done. ${ok} converted, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
