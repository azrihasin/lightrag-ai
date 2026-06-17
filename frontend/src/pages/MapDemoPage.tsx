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

// Key route polyline (DUKE highway section)
const DUKE_ROUTE: [number, number][] = [
  [3.2100, 101.6360],
  [3.1791, 101.6903],
  [3.1651, 101.6981],
  [3.1610, 101.7113],
];

// Origin → destination backhaul flows (curved arcs)
const BACKHAUL_FLOWS = [
  { from: [3.1528, 101.7038] as [number, number], to: [2.9213, 101.6559] as [number, number] },
  { from: [3.1791, 101.6903] as [number, number], to: [3.0567, 101.5851] as [number, number] },
  { from: [3.1348, 101.6245] as [number, number], to: [2.9264, 101.6964] as [number, number] },
];

export default function MapDemoPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8 p-4 md:p-6">
        <section className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Map Components</h1>
          <p className="text-sm text-muted-foreground">
            Interactive MapLibre GL map components powered by mapcn — rendered via the json-render catalog.
          </p>
        </section>

        {/* ── Full-featured map ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Full Feature Map</h2>
            <p className="text-xs text-muted-foreground">
              Clustered data markers · route polyline · origin→destination arcs · zoom · fullscreen · locate · compass
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "MINDS Geo-Pro — Site Coverage & Network Map",
              description: "Telekom Malaysia BTS sites with 5G/4G coverage. Click a point for details.",
              center: CENTER,
              zoom: 12,
              cluster: true,
              data: SAMPLE_SITES,
              latField: "latitude",
              lngField: "longitude",
              labelField: "site_name",
              popupFields: ["city", "status", "technology"],
              routes: [{ positions: DUKE_ROUTE, color: "#2563eb", width: 3 }],
              arcs: BACKHAUL_FLOWS,
              controls: {
                zoom: true,
                fullscreen: true,
                locate: true,
                compass: true,
              },
            }}
          />
        </section>

        {/* ── Markers, popups & tooltips ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Markers · Popups · Tooltips</h2>
            <p className="text-xs text-muted-foreground">
              SQL rows with lat/lng → individual markers; hover for the label, click for field details
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "All Network Sites — Individual Markers",
              center: CENTER,
              zoom: 11,
              data: SAMPLE_SITES,
              latField: "latitude",
              lngField: "longitude",
              labelField: "site_name",
              popupFields: ["city", "status", "technology"],
              controls: { zoom: true, fullscreen: true },
            }}
          />
        </section>

        {/* ── Marker clustering ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Marker Clustering</h2>
            <p className="text-xs text-muted-foreground">
              MapLibre clustering — points group at low zoom and split apart as you zoom in
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "All Network Sites — Clustered View",
              center: CENTER,
              zoom: 9,
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

        {/* ── Routes & arcs ── */}
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Routes &amp; Arcs</h2>
            <p className="text-xs text-muted-foreground">
              Polyline routes and curved origin→destination arc connectors
            </p>
          </div>
          <GeoMapRenderer
            props={{
              title: "Backhaul Routes & Flows",
              center: CENTER,
              zoom: 11,
              markers: [
                { position: [3.1528, 101.7038], label: "KL Tower BTS", tooltip: "KL Tower BTS", color: "#2563eb" },
                { position: [2.9213, 101.6559], label: "Cyberjaya", tooltip: "Cyberjaya", color: "#16a34a" },
              ],
              routes: [{ positions: DUKE_ROUTE, color: "#2563eb", width: 3, dashed: true }],
              arcs: BACKHAUL_FLOWS,
              controls: { zoom: true, fullscreen: true, compass: true },
            }}
          />
        </section>
      </div>
    </div>
  );
}
