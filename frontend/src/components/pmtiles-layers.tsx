"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { leafletLayer, PolygonSymbolizer, LineSymbolizer } from "protomaps-leaflet";
import { LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MapControlContainer } from "@/components/ui/map";

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

const DEFAULT_COLOR = "#2563eb";

/**
 * Renders coverage/congestion PMTiles vector overlays via protomaps-leaflet and
 * exposes a layer-toggle + week-selector control. One week is shown at a time;
 * switching weeks keeps the same active layer keys but swaps their tile sources.
 *
 * Must be rendered as a child of the react-leaflet <MapContainer> (uses useMap).
 */
export function PMTilesOverlay({ config }: { config: PMTilesConfig }) {
  const map = useMap();

  const weeks = config.weeks ?? [];
  const weekIds = useMemo(() => weeks.map((w) => w.week), [weeks]);

  const [selectedWeek, setSelectedWeek] = useState(
    weekIds.includes(config.week) ? config.week : (weekIds[0] ?? config.week),
  );
  const [activeKeys, setActiveKeys] = useState<Set<string>>(
    () => new Set(config.activeKeys ?? []),
  );

  // Layers available for the currently selected week.
  const weekLayers = useMemo<PMTilesLayer[]>(
    () => weeks.find((w) => w.week === selectedWeek)?.layers ?? [],
    [weeks, selectedWeek],
  );

  // Live protomaps layer instances keyed by `${week}:${layerKey}`.
  const liveRef = useRef<Map<string, any>>(new Map());

  // Reconcile the on-map protomaps layers with (selectedWeek × activeKeys).
  useEffect(() => {
    if (!map) return;
    const live = liveRef.current;

    const desired = new Map<string, PMTilesLayer>();
    for (const l of weekLayers) {
      if (activeKeys.has(l.key)) desired.set(`${selectedWeek}:${l.key}`, l);
    }

    // Remove layers no longer desired (deselected, or from a different week).
    for (const [id, layer] of live) {
      if (!desired.has(id)) {
        try {
          map.removeLayer(layer);
        } catch {
          /* already gone */
        }
        live.delete(id);
      }
    }

    // Add newly-desired layers.
    for (const [id, l] of desired) {
      if (live.has(id)) continue;
      const color = l.color || DEFAULT_COLOR;
      try {
        const layer = leafletLayer({
          url: l.url,
          maxDataZoom: 12,
          // Stack above the base tile layer (default zIndex 1) within the
          // tilePane so coverage overlays are visible; stays below markers/popups.
          zIndex: 400,
          paintRules: [
            {
              dataLayer: l.sourceLayer,
              symbolizer: new PolygonSymbolizer({ fill: color, opacity: 0.45 }),
            },
            {
              dataLayer: l.sourceLayer,
              symbolizer: new LineSymbolizer({ color, width: 0.6 }),
            },
          ],
        });
        layer.addTo(map);
        live.set(id, layer);
      } catch (err) {
        console.error(`Failed to add PMTiles layer ${l.url}`, err);
      }
    }
  }, [map, selectedWeek, activeKeys, weekLayers]);

  // Clean every layer off the map on unmount.
  useEffect(() => {
    return () => {
      const live = liveRef.current;
      for (const [, layer] of live) {
        try {
          map?.removeLayer(layer);
        } catch {
          /* ignore */
        }
      }
      live.clear();
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

  if (weeks.length === 0) return null;

  return (
    <MapControlContainer className="top-12 right-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Coverage layers"
            title="Coverage layers"
            className="border">
            <LayersIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-1000 max-h-80 overflow-auto">
          {weekIds.length > 1 && (
            <>
              <DropdownMenuLabel>Week</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedWeek}
                onValueChange={setSelectedWeek}>
                {weekIds.map((w) => (
                  <DropdownMenuRadioItem key={w} value={w}>
                    {w.replace("_", "/")}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>Layers</DropdownMenuLabel>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </MapControlContainer>
  );
}
