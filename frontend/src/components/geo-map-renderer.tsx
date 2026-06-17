"use client";

import { Fragment, useMemo, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { cn } from "@/lib/utils";
import {
  MapLayerControl,
  type MapType,
  type PMTilesConfig,
} from "@/components/pmtiles-layers";
import {
  Map,
  MapArc,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MapRoute,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  type MapArcDatum,
} from "@/components/ui/map";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The public contract stays in [lat, lng] order (Leaflet convention, what the
// backend emits). mapcn / MapLibre uses [lng, lat], so every coordinate is
// converted at the mapcn boundary via `toLngLat`.

export type LatLng = [number, number];

type FieldVal = string | number | null | undefined;

export interface MarkerConfig {
  position: LatLng;
  label?: string;
  tooltip?: string;
  /** Key/value rows shown in the marker popup body. */
  fields?: Record<string, FieldVal>;
  /** Marker dot color (CSS color). Defaults to the theme primary. */
  color?: string;
}

export interface RouteConfig {
  positions: LatLng[];
  color?: string;
  width?: number;
  dashed?: boolean;
}

export interface ArcConfig {
  from: LatLng;
  to: LatLng;
}

export interface GeoMapControls {
  zoom?: boolean;
  fullscreen?: boolean;
  locate?: boolean;
  compass?: boolean;
}

export interface MapStyleConfig {
  /** MapLibre style URL for light theme. Defaults to CARTO Positron. */
  light?: string;
  /** MapLibre style URL for dark theme. Defaults to CARTO Dark Matter. */
  dark?: string;
}

export interface GeoMapProps {
  title?: string;
  description?: string;
  // Viewport
  center: LatLng;
  zoom?: number;
  /** Custom light/dark MapLibre style URLs. */
  styles?: MapStyleConfig;
  /** Coverage/congestion PMTiles vector overlays + week/layer controls. */
  pmtiles?: PMTilesConfig;
  // Data-driven markers from SQL rows
  data?: Record<string, FieldVal>[];
  latField?: string;
  lngField?: string;
  /** Column whose value becomes the marker tooltip and popup heading */
  labelField?: string;
  /** Columns to include in the popup. Defaults to all non-geo columns. */
  popupFields?: string[];
  // Explicit features
  markers?: MarkerConfig[];
  /** Cluster nearby markers automatically (MapLibre clustering) */
  cluster?: boolean;
  /** Polylines drawn as map routes */
  routes?: RouteConfig[];
  /** Curved origin→destination connectors (trips, shipments, flows) */
  arcs?: ArcConfig[];
  // Control panel visibility
  controls?: GeoMapControls;
}

// ─── Basemaps ───────────────────────────────────────────────────────────────
//
// The "Default" map type uses the caller's styles (or mapcn's CARTO defaults via
// the <Map> component). "Satellite" swaps in an Esri World Imagery raster style,
// applied to both light and dark so the theme toggle is a no-op while active.

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "satellite-tiles": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite-tiles" }],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidLat(n: number) {
  return isFinite(n) && n >= -90 && n <= 90;
}
function isValidLng(n: number) {
  return isFinite(n) && n >= -180 && n <= 180;
}

/** [lat, lng] (public order) → [lng, lat] (MapLibre order). */
function toLngLat([lat, lng]: LatLng): [number, number] {
  return [lng, lat];
}

function fieldEntries(fields?: Record<string, FieldVal>): [string, FieldVal][] {
  if (!fields) return [];
  return Object.entries(fields).filter(([, v]) => v != null && v !== "");
}

function PopupBody({
  label,
  fields,
}: {
  label?: string;
  fields?: Record<string, FieldVal>;
}) {
  const entries = fieldEntries(fields);
  return (
    <div className="space-y-1">
      {label && <p className="text-foreground text-sm font-medium">{label}</p>}
      {entries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {entries.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground">{String(v)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function RenderMarker({ m }: { m: MarkerConfig }) {
  const [lng, lat] = toLngLat(m.position);
  const hasPopup = Boolean(m.label) || fieldEntries(m.fields).length > 0;
  return (
    <MapMarker longitude={lng} latitude={lat}>
      <MarkerContent>
        <div
          className={cn(
            "size-3.5 rounded-full border-2 border-white shadow-md",
            !m.color && "bg-primary",
          )}
          style={m.color ? { backgroundColor: m.color } : undefined}
        />
      </MarkerContent>
      {m.tooltip && <MarkerTooltip>{m.tooltip}</MarkerTooltip>}
      {hasPopup && (
        <MarkerPopup closeButton>
          <PopupBody label={m.label} fields={m.fields} />
        </MarkerPopup>
      )}
    </MapMarker>
  );
}

type SelectedPoint = {
  lng: number;
  lat: number;
  label?: string;
  fields?: Record<string, FieldVal>;
};

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function GeoMapRenderer({ props }: { props: GeoMapProps }) {
  const {
    title,
    description,
    center,
    zoom = 13,
    styles,
    pmtiles,
    data,
    latField,
    lngField,
    labelField,
    popupFields,
    markers: explicitMarkers,
    cluster = false,
    routes,
    arcs,
    controls = {},
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
      const keys =
        popupFields?.length
          ? popupFields
          : Object.keys(row).filter((k) => k !== latField && k !== lngField);
      const fields: Record<string, FieldVal> = {};
      for (const k of keys) fields[k] = row[k];

      result.push({ position: [lat, lng], label, tooltip: label, fields });
    }
    return result;
  }, [data, latField, lngField, labelField, popupFields]);

  const allMarkers = useMemo<MarkerConfig[]>(
    () => [...(explicitMarkers ?? []), ...dataMarkers],
    [explicitMarkers, dataMarkers],
  );

  // GeoJSON FeatureCollection for the clustered path. `fields` is JSON-encoded
  // because MapLibre feature-state/properties only carry scalar values.
  const clusterData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: allMarkers.map((m, i) => {
        const [lng, lat] = toLngLat(m.position);
        return {
          type: "Feature" as const,
          id: i,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: {
            label: m.label ?? "",
            fields: JSON.stringify(m.fields ?? {}),
          },
        };
      }),
    }),
    [allMarkers],
  );

  const arcData = useMemo<MapArcDatum[]>(
    () =>
      (arcs ?? []).map((a, i) => ({
        id: i,
        from: toLngLat(a.from),
        to: toLngLat(a.to),
      })),
    [arcs],
  );

  const [selected, setSelected] = useState<SelectedPoint | null>(null);

  // Basemap toggle (Default / Satellite) driven by the layer control. Satellite
  // forces the Esri raster style for both themes; Default falls back to the
  // caller-provided styles (or mapcn's CARTO defaults).
  const [mapType, setMapType] = useState<MapType>("default");
  const effectiveStyles = useMemo(
    () =>
      mapType === "satellite"
        ? { light: SATELLITE_STYLE, dark: SATELLITE_STYLE }
        : styles,
    [mapType, styles],
  );

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

  return (
    <div className="flex w-full flex-col gap-2">
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

      <div className="relative h-[500px] w-full overflow-hidden rounded-md border">
        <Map center={toLngLat(center)} zoom={zoom} styles={effectiveStyles}>
          {/* Markers — clustered or individual */}
          {cluster ? (
            <>
              <MapClusterLayer
                data={clusterData}
                onPointClick={(feature, coordinates) => {
                  const p = (feature.properties ?? {}) as {
                    label?: string;
                    fields?: string;
                  };
                  let fields: Record<string, FieldVal> = {};
                  try {
                    fields = JSON.parse(p.fields ?? "{}");
                  } catch {
                    /* keep empty */
                  }
                  setSelected({
                    lng: coordinates[0],
                    lat: coordinates[1],
                    label: p.label || undefined,
                    fields,
                  });
                }}
              />
              {selected && (
                <MapPopup
                  longitude={selected.lng}
                  latitude={selected.lat}
                  closeButton
                  onClose={() => setSelected(null)}
                >
                  <PopupBody label={selected.label} fields={selected.fields} />
                </MapPopup>
              )}
            </>
          ) : (
            allMarkers.map((m, i) => <RenderMarker key={i} m={m} />)
          )}

          {/* Polylines → routes */}
          {routes?.map((r, i) =>
            r.positions.length < 2 ? null : (
              <MapRoute
                key={i}
                coordinates={r.positions.map(toLngLat)}
                color={r.color}
                width={r.width}
                dashArray={r.dashed ? [2, 2] : undefined}
              />
            ),
          )}

          {/* Origin → destination flows → arcs */}
          {arcData.length > 0 && <MapArc data={arcData} />}

          {/* Map type + week/layer control (PMTiles overlays) */}
          <MapLayerControl
            mapType={mapType}
            onMapTypeChange={setMapType}
            pmtiles={pmtiles}
          />

          <MapControls
            position="top-right"
            showZoom={controls.zoom !== false}
            showFullscreen={controls.fullscreen !== false}
            showLocate={controls.locate === true}
            showCompass={controls.compass === true}
          />
        </Map>
      </div>

      {data && latField && lngField && dataMarkers.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">
          No rows with valid coordinates found in fields &quot;{latField}&quot; /
          &quot;{lngField}&quot;.
        </p>
      )}
    </div>
  );
}
