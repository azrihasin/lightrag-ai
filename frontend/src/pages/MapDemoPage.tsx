"use client";

import { GeoMapRenderer } from "@/components/geo-map-renderer";

// Sample sites in Malaysia (Telekom Malaysia context)
const SAMPLE_SITES = [
  { site_name: "KL Tower BTS", city: "Kuala Lumpur", status: "Active", technology: "5G", latitude: 3.1528, longitude: 101.7038 },
  { site_name: "Petronas BTS", city: "Kuala Lumpur", status: "Active", technology: "5G", latitude: 3.1579, longitude: 101.7116 },
  { site_name: "KLCC Annex", city: "Kuala Lumpur", status: "Active", technology: "4G", latitude: 3.1610, longitude: 101.7113 },
  { site_name: "Bukit Bintang", city: "Kuala Lumpur", status: "Degraded", technology: "4G", latitude: 3.1468, longitude: 101.7101 },
  { site_name: "Chow Kit BTS", city: "Kuala Lumpur", status: "Active", technology: "4G", latitude: 3.1651, longitude: 101.6981 },
  { site_name: "Sentul Hub", city: "Kuala Lumpur", status: "Active", technology: "5G", latitude: 3.1791, longitude: 101.6903 },
  { site_name: "Kepong North", city: "Selangor", status: "Active", technology: "4G", latitude: 3.2100, longitude: 101.6360 },
  { site_name: "PJ Damansara", city: "Selangor", status: "Active", technology: "5G", latitude: 3.1348, longitude: 101.6245 },
  { site_name: "Shah Alam", city: "Selangor", status: "Inactive", technology: "4G", latitude: 3.0738, longitude: 101.5183 },
  { site_name: "Subang Jaya", city: "Selangor", status: "Active", technology: "5G", latitude: 3.0567, longitude: 101.5851 },
  { site_name: "Cyberjaya", city: "Selangor", status: "Active", technology: "5G", latitude: 2.9213, longitude: 101.6559 },
  { site_name: "Putrajaya", city: "Putrajaya", status: "Active", technology: "5G", latitude: 2.9264, longitude: 101.6964 },
];

const CENTER: [number, number] = [3.1319, 101.6841];

// Coverage polygon around KL city center
const KL_COVERAGE_POLYGON: [number, number][] = [
  [3.1800, 101.6700],
  [3.1800, 101.7200],
  [3.1200, 101.7300],
  [3.1100, 101.6800],
  [3.1300, 101.6600],
];

// Key route polyline (DUKE highway section)
const DUKE_ROUTE: [number, number][] = [
  [3.2100, 101.6360],
  [3.1791, 101.6903],
  [3.1651, 101.6981],
  [3.1610, 101.7113],
];

export default function MapDemoPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8 p-4 md:p-6">
        <section className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Map Components</h1>
          <p className="text-sm text-muted-foreground">
            Interactive Leaflet map components powered by shadcn-map — rendered via the json-render catalog.
          </p>
        </section>

        {/* ── Full-featured map ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Full Feature Map</h2>
            <p className="text-xs text-muted-foreground">
              Multiple tile layers · layer groups · marker clustering · shapes · zoom · fullscreen · locate · draw controls
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "MINDS Geo-Pro — Site Coverage & Network Map",
              description: "Telekom Malaysia BTS sites with 5G/4G coverage overlay. Toggle layers to filter by technology.",
              center: CENTER,
              zoom: 12,
              cluster: true,
              data: SAMPLE_SITES,
              latField: "latitude",
              lngField: "longitude",
              labelField: "site_name",
              popupFields: ["site_name", "city", "status", "technology"],
              tileLayers: [
                {
                  name: "Light",
                  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
                  darkUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
                },
                {
                  name: "Street",
                  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                },
                {
                  name: "Satellite",
                  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                  attribution: "Tiles &copy; Esri",
                },
              ],
              layers: [
                {
                  name: "5G Sites",
                  defaultActive: true,
                  markers: SAMPLE_SITES.filter((s) => s.technology === "5G").map((s) => ({
                    position: [s.latitude, s.longitude] as [number, number],
                    label: s.site_name,
                    tooltip: `${s.site_name} — ${s.status}`,
                    popup: `<b>${s.site_name}</b><br/>Technology: 5G<br/>Status: ${s.status}<br/>City: ${s.city}`,
                  })),
                },
                {
                  name: "4G Sites",
                  defaultActive: true,
                  markers: SAMPLE_SITES.filter((s) => s.technology === "4G").map((s) => ({
                    position: [s.latitude, s.longitude] as [number, number],
                    label: s.site_name,
                    tooltip: `${s.site_name} — ${s.status}`,
                    popup: `<b>${s.site_name}</b><br/>Technology: 4G<br/>Status: ${s.status}<br/>City: ${s.city}`,
                  })),
                },
                {
                  name: "Coverage Zones",
                  defaultActive: true,
                  shapes: [
                    {
                      type: "polygon",
                      positions: KL_COVERAGE_POLYGON,
                      popup: "<b>KL City Core Coverage</b><br/>5G/4G active coverage zone",
                      tooltip: "KL City Core Coverage",
                    },
                    {
                      type: "circle",
                      center: [2.9213, 101.6559] as [number, number],
                      radius: 3000,
                      popup: "<b>Cyberjaya Coverage</b><br/>Radius: 3 km",
                      tooltip: "Cyberjaya Coverage Zone",
                    },
                  ],
                },
                {
                  name: "Routes",
                  defaultActive: false,
                  shapes: [
                    {
                      type: "polyline",
                      positions: DUKE_ROUTE,
                      popup: "<b>DUKE Highway Corridor</b><br/>Active BTS route",
                      tooltip: "DUKE Highway Route",
                    },
                  ],
                },
              ],
              shapes: [
                {
                  type: "rectangle",
                  bounds: [
                    [3.14, 101.68],
                    [3.17, 101.72],
                  ],
                  popup: "<b>KL City Centre Bounding Box</b>",
                  tooltip: "KLCC Bounding Box",
                },
                {
                  type: "circleMarker",
                  center: [2.9264, 101.6964] as [number, number],
                  radius: 8,
                  popup: "<b>Putrajaya Federal Admin Area</b>",
                  tooltip: "Putrajaya",
                },
              ],
              controls: {
                zoom: true,
                fullscreen: true,
                locate: true,
                search: false,
                layers: true,
                draw: {
                  marker: true,
                  polyline: true,
                  polygon: true,
                  circle: true,
                  rectangle: true,
                  edit: true,
                  delete: true,
                  undo: true,
                },
              },
            }}
          />
        </section>

        {/* ── Simple markers map ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Marker Clustering</h2>
            <p className="text-xs text-muted-foreground">
              SQL rows with lat/lng auto-converted to clustered markers
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "All Network Sites — Clustered View",
              center: CENTER,
              zoom: 11,
              cluster: true,
              data: SAMPLE_SITES,
              latField: "latitude",
              lngField: "longitude",
              labelField: "site_name",
              popupFields: ["city", "status", "technology"],
              controls: { zoom: true, fullscreen: true },
            }}
          />
        </section>

        {/* ── Shapes showcase ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Shapes & Overlays</h2>
            <p className="text-xs text-muted-foreground">
              Circle · CircleMarker · Polyline · Polygon · Rectangle
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "Coverage Shapes Showcase",
              center: [3.14, 101.69] as [number, number],
              zoom: 12,
              shapes: [
                {
                  type: "circle",
                  center: [3.1579, 101.7116] as [number, number],
                  radius: 1500,
                  popup: "<b>Petronas Towers</b><br/>1.5 km coverage circle",
                  tooltip: "Petronas 1.5 km radius",
                },
                {
                  type: "circleMarker",
                  center: [3.1528, 101.7038] as [number, number],
                  radius: 12,
                  popup: "<b>KL Tower</b><br/>Fixed-pixel circle marker",
                  tooltip: "KL Tower marker",
                },
                {
                  type: "polygon",
                  positions: KL_COVERAGE_POLYGON,
                  popup: "<b>KL City Coverage Zone</b>",
                  tooltip: "KL Coverage Polygon",
                },
                {
                  type: "polyline",
                  positions: DUKE_ROUTE,
                  popup: "<b>DUKE Highway Fibre Route</b>",
                  tooltip: "DUKE Route",
                },
                {
                  type: "rectangle",
                  bounds: [
                    [3.11, 101.67],
                    [3.16, 101.73],
                  ],
                  popup: "<b>KL Bounding Rectangle</b>",
                  tooltip: "KL Bounding Box",
                },
              ],
              controls: { zoom: true, fullscreen: true },
            }}
          />
        </section>

        {/* ── Draw controls ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Draw Controls</h2>
            <p className="text-xs text-muted-foreground">
              Freehand drawing — marker · polyline · polygon · circle · rectangle · edit · delete · undo
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "Draw Tools Demo",
              center: CENTER,
              zoom: 12,
              controls: {
                zoom: true,
                fullscreen: true,
                draw: {
                  marker: true,
                  polyline: true,
                  polygon: true,
                  circle: true,
                  rectangle: true,
                  edit: true,
                  delete: true,
                  undo: true,
                },
              },
            }}
          />
        </section>
      </div>
    </div>
  );
}
