"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { LayersIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMap } from "@/components/ui/map";
import { cn } from "@/lib/utils";

// ─── Types (mirror backend MapTilesService / catalog.ts pmtilesConfig) ─────────

export interface PMTilesLayer {
  key: string;
  label: string;
  category?: string | null;
  sourceLayer: string;
  url: string;
  color?: string | null;
}

export interface PMTilesWeek {
  week: string;
  layers: PMTilesLayer[];
}

export interface PMTilesConfig {
  week: string;
  activeKeys: string[];
  weeks: PMTilesWeek[];
}

/** Base map style toggled from the layer control. */
export type MapType = "default" | "satellite";

const DEFAULT_COLOR = "#2563eb";

// The `pmtiles://` protocol is global to maplibre-gl; register it once.
let protocolRegistered = false;
function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

const srcId = (id: string) => `pmtiles:${id}`;
const fillId = (id: string) => `pmtiles-fill:${id}`;
const lineId = (id: string) => `pmtiles-line:${id}`;

/**
 * Map layer control for the mapcn <Map>. Renders a single dropdown — styled to
 * match the mapcn MapControls theme — with three sections separated by small
 * titles (no dividers):
 *
 *   • Map type — Default / Satellite basemap (radio, lifted to the parent)
 *   • Week     — one active week of PMTiles overlays at a time (radio)
 *   • Layers   — coverage/congestion PMTiles vector overlays (checkbox)
 *
 * Also owns the PMTiles map plumbing: each active layer becomes a vector source
 * (`pmtiles://<url>`) with a fill layer (polygons) and a line layer (lines +
 * polygon outlines). Must be rendered as a child of <Map> (uses `useMap`).
 */
export function MapLayerControl({
  mapType,
  onMapTypeChange,
  pmtiles,
}: {
  mapType: MapType;
  onMapTypeChange: (type: MapType) => void;
  pmtiles?: PMTilesConfig;
}) {
  const { map, isLoaded } = useMap();

  const weeks = pmtiles?.weeks ?? [];
  const weekIds = useMemo(() => weeks.map((w) => w.week), [weeks]);

  const [selectedWeek, setSelectedWeek] = useState(
    weekIds.includes(pmtiles?.week ?? "")
      ? (pmtiles?.week as string)
      : (weekIds[0] ?? pmtiles?.week ?? ""),
  );
  const [activeKeys, setActiveKeys] = useState<Set<string>>(
    () => new Set(pmtiles?.activeKeys ?? []),
  );

  // Layers available for the currently selected week.
  const weekLayers = useMemo<PMTilesLayer[]>(
    () => weeks.find((w) => w.week === selectedWeek)?.layers ?? [],
    [weeks, selectedWeek],
  );

  // Logical ids (`${week}:${key}`) currently added to the map.
  const liveRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    ensurePmtilesProtocol();
  }, []);

  // Reconcile the on-map vector sources/layers with (selectedWeek × activeKeys).
  // Re-runs when the style reloads (isLoaded toggles on theme / map-type change)
  // — a setStyle wipes custom sources/layers, so getSource/getLayer guards drive
  // a clean re-add.
  useEffect(() => {
    if (!map || !isLoaded) return;

    const desired = new Map<string, PMTilesLayer>();
    for (const l of weekLayers) {
      if (activeKeys.has(l.key)) desired.set(`${selectedWeek}:${l.key}`, l);
    }

    // Remove layers no longer desired (deselected, or from a different week).
    for (const id of Array.from(liveRef.current)) {
      if (!desired.has(id)) {
        removeLayer(map, id);
        liveRef.current.delete(id);
      }
    }

    // Add newly-desired layers (skip any that already exist on the map).
    for (const [id, l] of desired) {
      if (map.getSource(srcId(id))) {
        liveRef.current.add(id);
        continue;
      }
      const color = l.color || DEFAULT_COLOR;
      try {
        map.addSource(srcId(id), {
          type: "vector",
          url: `pmtiles://${l.url}`,
        });
        map.addLayer({
          id: fillId(id),
          type: "fill",
          source: srcId(id),
          "source-layer": l.sourceLayer,
          paint: { "fill-color": color, "fill-opacity": 0.45 },
        });
        map.addLayer({
          id: lineId(id),
          type: "line",
          source: srcId(id),
          "source-layer": l.sourceLayer,
          paint: { "line-color": color, "line-width": 0.6 },
        });
        liveRef.current.add(id);
      } catch (err) {
        console.error(`Failed to add PMTiles layer ${l.url}`, err);
      }
    }
  }, [map, isLoaded, selectedWeek, activeKeys, weekLayers]);

  // Clean every layer off the map on unmount.
  useEffect(() => {
    return () => {
      if (!map) return;
      for (const id of Array.from(liveRef.current)) {
        removeLayer(map, id);
      }
      liveRef.current.clear();
    };
  }, [map]);

  function toggleLayer(key: string, checked: boolean) {
    setActiveKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const showWeeks = weekIds.length > 1;
  const showLayers = weekLayers.length > 0;

  return (
    <div className="absolute left-2 top-2 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Map layers"
            title="Map layers"
            className={cn(
              "border-border bg-background flex size-8 items-center justify-center rounded-md border shadow-sm transition-all",
              "hover:bg-accent dark:hover:bg-accent/40",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
              "data-[state=open]:bg-accent dark:data-[state=open]:bg-accent/40",
            )}>
            <LayersIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="z-[1000] max-h-[420px] w-52 overflow-auto">
          {/* Map type — basemap selector */}
          <SectionTitle>Map type</SectionTitle>
          <DropdownMenuRadioGroup
            value={mapType}
            onValueChange={(v) => onMapTypeChange(v as MapType)}>
            <DropdownMenuRadioItem value="default">
              Default
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="satellite">
              Satellite
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          {/* Week — one PMTiles week active at a time */}
          {showWeeks && (
            <>
              <SectionTitle>Week</SectionTitle>
              <DropdownMenuRadioGroup
                value={selectedWeek}
                onValueChange={setSelectedWeek}>
                {weekIds.map((w) => (
                  <DropdownMenuRadioItem key={w} value={w}>
                    {w.replace("_", "/")}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}

          {/* Layers — PMTiles overlays */}
          {showLayers && (
            <>
              <SectionTitle>Layers</SectionTitle>
              {weekLayers.map((l) => (
                <DropdownMenuCheckboxItem
                  key={l.key}
                  checked={activeKeys.has(l.key)}
                  onCheckedChange={(checked) => toggleLayer(l.key, checked)}>
                  <span
                    className="mr-2 inline-block size-3 rounded-[3px] align-middle"
                    style={{ backgroundColor: l.color || DEFAULT_COLOR }}
                  />
                  {l.label}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Small muted section heading — separates dropdown sections without a divider. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide first:pt-1.5">
      {children}
    </DropdownMenuLabel>
  );
}

function removeLayer(map: maplibregl.Map, id: string) {
  try {
    if (map.getLayer(fillId(id))) map.removeLayer(fillId(id));
    if (map.getLayer(lineId(id))) map.removeLayer(lineId(id));
    if (map.getSource(srcId(id))) map.removeSource(srcId(id));
  } catch {
    /* style may already be torn down */
  }
}
