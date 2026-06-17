"use client";

import { useMemo } from "react";
import { PMTilesOverlay, type PMTilesConfig } from "@/components/pmtiles-layers";
import {
  Map,
  MapCircle,
  MapCircleMarker,
  MapDrawCircle,
  MapDrawControl,
  MapDrawDelete,
  MapDrawEdit,
  MapDrawMarker,
  MapDrawPolygon,
  MapDrawPolyline,
  MapDrawRectangle,
  MapDrawUndo,
  MapFullscreenControl,
  MapLayerGroup,
  MapLayers,
  MapLayersControl,
  MapLocateControl,
  MapMarker,
  MapMarkerClusterGroup,
  MapPolygon,
  MapPolyline,
  MapPopup,
  MapRectangle,
  MapSearchControl,
  MapTileLayer,
  MapTooltip,
  MapZoomControl,
} from "@/components/ui/map";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LatLng = [number, number];

export interface MarkerConfig {
  position: LatLng;
  label?: string;
  /** HTML string rendered inside the popup */
  popup?: string;
  tooltip?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export type ShapeConfig =
  | { type: "circle"; center: LatLng; radius: number; popup?: string; tooltip?: string }
  | { type: "circleMarker"; center: LatLng; radius?: number; popup?: string; tooltip?: string }
  | { type: "polyline"; positions: LatLng[]; popup?: string; tooltip?: string }
  | { type: "polygon"; positions: LatLng[]; popup?: string; tooltip?: string }
  | { type: "rectangle"; bounds: [LatLng, LatLng]; popup?: string; tooltip?: string };

export interface TileLayerConfig {
  name?: string;
  url?: string;
  darkUrl?: string;
  attribution?: string;
  darkAttribution?: string;
}

export interface LayerGroupConfig {
  name: string;
  defaultActive?: boolean;
  markers?: MarkerConfig[];
  shapes?: ShapeConfig[];
}

export interface DrawConfig {
  marker?: boolean;
  polyline?: boolean;
  polygon?: boolean;
  circle?: boolean;
  rectangle?: boolean;
  edit?: boolean;
  delete?: boolean;
  undo?: boolean;
}

export interface GeoMapControls {
  zoom?: boolean;
  fullscreen?: boolean;
  locate?: boolean;
  search?: boolean;
  layers?: boolean;
  draw?: boolean | DrawConfig;
}

export interface GeoMapProps {
  title?: string;
  description?: string;
  // Viewport
  center: LatLng;
  zoom?: number;
  /** Coverage/congestion PMTiles vector overlays + week/layer controls. */
  pmtiles?: PMTilesConfig;
  // Data-driven markers from SQL rows
  data?: Record<string, unknown>[];
  latField?: string;
  lngField?: string;
  /** Column whose value becomes the marker tooltip and popup heading */
  labelField?: string;
  /** Columns to include in the popup. Defaults to all non-geo columns. */
  popupFields?: string[];
  // Explicit features
  markers?: MarkerConfig[];
  /** Cluster nearby markers automatically */
  cluster?: boolean;
  shapes?: ShapeConfig[];
  // Tile layer configuration
  tileLayers?: TileLayerConfig[];
  // Toggleable named layer groups
  layers?: LayerGroupConfig[];
  // Control panel visibility
  controls?: GeoMapControls;
  /** Shorthand draw tools config when controls.draw is not set */
  draw?: DrawConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidLat(n: number) {
  return isFinite(n) && n >= -90 && n <= 90;
}
function isValidLng(n: number) {
  return isFinite(n) && n >= -180 && n <= 180;
}

function buildRowPopup(
  row: Record<string, unknown>,
  fields: string[],
): string {
  return fields
    .map((f) => `<b>${f}:</b> ${row[f] ?? ""}`)
    .join("<br/>");
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function RenderMarker({ m, index }: { m: MarkerConfig; index: number }) {
  return (
    <MapMarker key={index} position={m.position}>
      {m.popup && (
        <MapPopup>
          <div
            className="text-sm"
            dangerouslySetInnerHTML={{ __html: m.popup }}
          />
        </MapPopup>
      )}
      {m.tooltip && (
        <MapTooltip side={m.tooltipSide}>{m.tooltip}</MapTooltip>
      )}
    </MapMarker>
  );
}

function RenderMarkers({
  markers,
  cluster,
}: {
  markers: MarkerConfig[];
  cluster: boolean;
}) {
  if (!markers.length) return null;
  if (cluster) {
    return (
      <MapMarkerClusterGroup>
        {markers.map((m, i) => (
          <RenderMarker key={i} m={m} index={i} />
        ))}
      </MapMarkerClusterGroup>
    );
  }
  return (
    <>
      {markers.map((m, i) => (
        <RenderMarker key={i} m={m} index={i} />
      ))}
    </>
  );
}

function RenderShape({ s, index }: { s: ShapeConfig; index: number }) {
  const popup = s.popup ? (
    <MapPopup>
      <div className="text-sm" dangerouslySetInnerHTML={{ __html: s.popup }} />
    </MapPopup>
  ) : null;
  const tooltip = s.tooltip ? (
    <MapTooltip>{s.tooltip}</MapTooltip>
  ) : null;

  switch (s.type) {
    case "circle":
      return (
        <MapCircle key={index} center={s.center} radius={s.radius}>
          {popup}
          {tooltip}
        </MapCircle>
      );
    case "circleMarker":
      return (
        <MapCircleMarker key={index} center={s.center} radius={s.radius ?? 10}>
          {popup}
          {tooltip}
        </MapCircleMarker>
      );
    case "polyline":
      if (s.positions.length < 2) return null;
      return (
        <MapPolyline key={index} positions={s.positions}>
          {popup}
          {tooltip}
        </MapPolyline>
      );
    case "polygon":
      if (s.positions.length < 3) return null;
      return (
        <MapPolygon key={index} positions={s.positions}>
          {popup}
          {tooltip}
        </MapPolygon>
      );
    case "rectangle":
      return (
        <MapRectangle key={index} bounds={s.bounds}>
          {popup}
          {tooltip}
        </MapRectangle>
      );
    default:
      return null;
  }
}

function RenderDrawControl({ cfg }: { cfg: DrawConfig }) {
  return (
    <MapDrawControl>
      {cfg.marker !== false && <MapDrawMarker />}
      {cfg.polyline !== false && <MapDrawPolyline />}
      {cfg.polygon !== false && <MapDrawPolygon />}
      {cfg.circle !== false && <MapDrawCircle />}
      {cfg.rectangle !== false && <MapDrawRectangle />}
      {cfg.edit !== false && <MapDrawEdit />}
      {cfg.delete !== false && <MapDrawDelete />}
      {cfg.undo !== false && <MapDrawUndo />}
    </MapDrawControl>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function GeoMapRenderer({ props }: { props: GeoMapProps }) {
  const {
    title,
    description,
    center,
    zoom = 13,
    pmtiles,
    data,
    latField,
    lngField,
    labelField,
    popupFields,
    markers: explicitMarkers = [],
    cluster = false,
    shapes = [],
    tileLayers = [],
    layers = [],
    controls = {},
    draw,
  } = props;

  // Convert SQL rows → markers, skipping rows with invalid/missing coordinates
  const dataMarkers = useMemo<MarkerConfig[]>(() => {
    if (!data?.length || !latField || !lngField) return [];
    const result: MarkerConfig[] = [];
    for (const row of data) {
      const lat = Number(row[latField]);
      const lng = Number(row[lngField]);
      if (!isValidLat(lat) || !isValidLng(lng)) continue;

      const label = labelField ? String(row[labelField] ?? "") : undefined;
      const fields =
        popupFields?.length
          ? popupFields
          : Object.keys(row).filter((k) => k !== latField && k !== lngField);
      const popup = buildRowPopup(row, fields);

      result.push({ position: [lat, lng], label, popup, tooltip: label });
    }
    return result;
  }, [data, latField, lngField, labelField, popupFields]);

  const allMarkers = [...explicitMarkers, ...dataMarkers];

  // Determine if MapLayers context is needed
  const hasMultipleTiles = tileLayers.length > 1;
  const hasLayerGroups = layers.length > 0;
  const needsLayersCtx = hasMultipleTiles || hasLayerGroups;

  const defaultTileName = tileLayers[0]?.name ?? "Default";
  const defaultActiveGroups = layers
    .filter((l) => l.defaultActive !== false)
    .map((l) => l.name);

  // Resolve control flags
  const showZoom = controls.zoom !== false;
  const showFullscreen = controls.fullscreen !== false;
  const showLocate = controls.locate === true;
  const showSearch = controls.search === true;
  const showLayersControl =
    controls.layers !== false && needsLayersCtx;

  // Resolve draw config: controls.draw (object/true) > draw prop
  const drawCfg: DrawConfig | undefined =
    typeof controls.draw === "object"
      ? controls.draw
      : typeof draw === "object"
      ? draw
      : controls.draw === true || Boolean(draw)
      ? {}
      : undefined;

  if (!center || !isValidLat(center[0]) || !isValidLng(center[1])) {
    return (
      <div className="flex flex-col gap-1">
        {title && <p className="text-sm font-medium">{title}</p>}
        <p className="text-sm text-muted-foreground">
          No valid map center coordinates available.
        </p>
      </div>
    );
  }

  // Shared controls rendered outside any layer context
  const controlsNode = (
    <>
      {showZoom && <MapZoomControl />}
      {showFullscreen && <MapFullscreenControl />}
      {showLocate && <MapLocateControl />}
      {showSearch && <MapSearchControl />}
      {drawCfg && <RenderDrawControl cfg={drawCfg} />}
    </>
  );

  const mapBody = needsLayersCtx ? (
    <MapLayers
      defaultTileLayer={defaultTileName}
      defaultLayerGroups={defaultActiveGroups}
    >
      {showLayersControl && <MapLayersControl />}

      {/* Tile layers — default CartoDB if none specified */}
      {tileLayers.length > 0 ? (
        tileLayers.map((tl, i) => (
          <MapTileLayer
            key={tl.name ?? i}
            name={tl.name}
            url={tl.url}
            darkUrl={tl.darkUrl}
            attribution={tl.attribution}
            darkAttribution={tl.darkAttribution}
          />
        ))
      ) : (
        <MapTileLayer />
      )}

      {/* Top-level markers/shapes — always visible, not bound to any group toggle */}
      <RenderMarkers markers={allMarkers} cluster={cluster} />
      {shapes.map((s, i) => (
        <RenderShape key={i} s={s} index={i} />
      ))}

      {/* Named toggleable layer groups */}
      {layers.map((layer) => (
        <MapLayerGroup key={layer.name} name={layer.name}>
          <RenderMarkers markers={layer.markers ?? []} cluster={cluster} />
          {layer.shapes?.map((s, i) => (
            <RenderShape key={i} s={s} index={i} />
          ))}
        </MapLayerGroup>
      ))}
    </MapLayers>
  ) : (
    <>
      <MapTileLayer />
      <RenderMarkers markers={allMarkers} cluster={cluster} />
      {shapes.map((s, i) => (
        <RenderShape key={i} s={s} index={i} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-2 w-full">
      {(title || description) && (
        <div className="px-1">
          {title && (
            <p className="text-sm font-semibold leading-tight">{title}</p>
          )}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      )}

      <Map center={center} zoom={zoom} className="h-[500px] w-full rounded-md">
        {mapBody}
        {pmtiles && <PMTilesOverlay config={pmtiles} />}
        {controlsNode}
      </Map>

      {data && latField && lngField && dataMarkers.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">
          No rows with valid coordinates found in fields &quot;{latField}&quot; /
          &quot;{lngField}&quot;.
        </p>
      )}
    </div>
  );
}
