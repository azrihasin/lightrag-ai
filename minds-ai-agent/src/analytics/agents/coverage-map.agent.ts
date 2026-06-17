import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import { MapTilesService, type CoverageLayer } from '../../map-tiles/map-tiles.service';

/** Derive a Leaflet zoom from a lng/lat bounding span. */
function zoomForSpan(span: number): number {
  if (!isFinite(span) || span <= 0) return 7;
  if (span > 30) return 4;
  if (span > 15) return 5;
  if (span > 8) return 6;
  if (span > 4) return 7;
  if (span > 1.5) return 8;
  if (span > 0.5) return 10;
  return 11;
}

const toPublicLayer = (l: CoverageLayer) => ({
  key: l.key,
  label: l.label,
  category: l.category,
  sourceLayer: l.sourceLayer,
  url: l.url,
  color: l.color,
});

/**
 * Subagent — render_coverage_map. Used for coverage / congestion map requests
 * (which are static PMTiles overlays, NOT database queries). It bypasses the SQL
 * pipeline: it picks which coverage/congestion layers to show for one week and
 * records a GeoMap spec (with pmtiles overlays) on the run blackboard for the
 * frontend to render. The key resolves to the "visualization" reasoning step.
 */
@Injectable()
export class CoverageMapAgentService {
  readonly agent: Agent;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly mapTiles: MapTilesService,
  ) {
    const layerKeys = this.mapTiles.getLayerKeys();
    const weekIds = this.mapTiles.getWeekIds();

    this.agent = new Agent({
      id: 'render_coverage_map',
      name: 'RenderCoverageMapAgent',
      description:
        'Render network COVERAGE or CONGESTION map layers (PMTiles overlays) on the map. ' +
        'Use for questions like "show 5G coverage", "show congestion", "map the TDD coverage for last week". ' +
        'Does NOT run SQL — it overlays pre-built tile layers.',
      instructions: [
        'You render network coverage/congestion layers on an interactive map.',
        '',
        'Available layers (week-independent keys):',
        ...layerKeys.map((l) => `  - ${l.key} (${l.category}) — ${l.label}`),
        '',
        `Available weeks (latest first): ${weekIds.join(', ') || '(none indexed)'}.`,
        '',
        'Begin your reply with ONE short sentence (e.g. "Mapping the requested coverage layers.").',
        'Then call select_coverage_map EXACTLY ONCE:',
        '- layerKeys: the layer keys the user asked for. If they said "coverage" generally, pass category="coverage" and leave layerKeys empty (all coverage layers). Same for "congestion". If they named specific technologies (5G, FDD, TDD, MOCN, HWC), pass those keys.',
        '- week: the week the user named; OMIT it to use the latest week. Only ONE week is shown at a time.',
        '- The user may ask for MULTIPLE layers — pass them all in layerKeys; they render as toggleable map layers.',
        'After the tool call, state in one short sentence which layers and week you mapped.',
      ].join('\n'),
      model: this.modelProvider.getModel() as any,
      tools: { select_coverage_map: this.selectTool() },
    });
  }

  private selectTool() {
    return createTool({
      id: 'select_coverage_map',
      description:
        'Record which coverage/congestion PMTiles layers to overlay for one week. ' +
        'The frontend renders them with a layer toggle control and a week selector.',
      inputSchema: z.object({
        layerKeys: z
          .array(z.string())
          .optional()
          .describe('Layer keys to show (e.g. ["5G_Coverage","FDD_Congestion"]). Empty = all in the category.'),
        category: z
          .enum(['coverage', 'congestion'])
          .optional()
          .describe('Restrict to all coverage OR all congestion layers when no specific keys are given.'),
        week: z
          .string()
          .optional()
          .describe('Week id like "WK08_25". Omit for the latest week. Only one week is shown per view.'),
        title: z.string().optional().describe('Short map title.'),
      }),
      outputSchema: z.object({
        recorded: z.boolean(),
        week: z.string().optional(),
        layers: z.array(z.string()),
        note: z.string().optional(),
      }),
      execute: async (input: {
        layerKeys?: string[];
        category?: 'coverage' | 'congestion';
        week?: string;
        title?: string;
      }) => {
        const run = currentRun();

        const week =
          (input.week && this.mapTiles.getWeek(input.week) ? input.week.toUpperCase() : undefined) ??
          this.mapTiles.getLatestWeek();

        if (!week) {
          return { recorded: false, layers: [], note: 'No coverage tile data is available.' };
        }

        const active = this.mapTiles.resolveLayers(week, input.layerKeys, input.category);
        if (active.length === 0) {
          return {
            recorded: false,
            week,
            layers: [],
            note: `No matching layers for ${week}. Available: ${this.mapTiles
              .getWeek(week)!
              .layers.map((l) => l.key)
              .join(', ')}`,
          };
        }

        // Viewport from the active layers' union bounds (fall back to world span).
        const bounds = this.mapTiles.unionBounds(active);
        let center: [number, number] = [4.2105, 108.5]; // Malaysia-ish fallback
        let zoom = 6;
        if (bounds) {
          const [minLng, minLat, maxLng, maxLat] = bounds;
          center = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
          zoom = zoomForSpan(Math.max(maxLng - minLng, maxLat - minLat));
        }

        // Full manifest so the frontend's week selector can swap weeks without a
        // round-trip; activeKeys carries which layers start toggled on.
        const weeks = this.mapTiles.getWeeks().map((w) => ({
          week: w.week,
          layers: w.layers.map(toPublicLayer),
        }));

        const props = {
          title: input.title ?? this.defaultTitle(active, week),
          center,
          zoom,
          controls: { layers: true, fullscreen: true },
          pmtiles: {
            week,
            activeKeys: active.map((l) => l.key),
            weeks,
          },
        };

        if (run) {
          run.spec = { componentType: 'GeoMap', props };
          run.vizChoice = 'GeoMap';
        }

        return { recorded: true, week, layers: active.map((l) => l.key) };
      },
    });
  }

  private defaultTitle(layers: CoverageLayer[], week: string): string {
    const cats = new Set(layers.map((l) => l.category));
    const what =
      cats.size === 1
        ? cats.has('congestion')
          ? 'Congestion'
          : 'Coverage'
        : 'Coverage & Congestion';
    return `Network ${what} — ${week.replace('_', '/')}`;
  }
}
