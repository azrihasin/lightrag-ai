import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { ModelProvider } from '../../chat/providers/model.provider';
import { currentRun } from '../analytics-run.store';
import type { ResultProfile } from '../profile/result-profile.types';
import type { SafeInsights } from '../profile/safe-insights.types';

/** Render the approved aggregate facts the summary may quote (no raw rows). */
function renderInsights(profile: ResultProfile, insights?: SafeInsights): string {
  const lines: string[] = [
    `rows: ${profile.rowCount}, columns: ${profile.columnCount}`,
    `fields: ${profile.columns.map((c) => `${c.name} (${c.role}/${c.semanticType})`).join(', ')}`,
  ];
  if (insights?.metrics?.length) {
    lines.push('approved metric facts:');
    for (const m of insights.metrics) {
      const parts = [
        m.total != null ? `total ${m.total}` : '',
        m.avg != null ? `avg ${Number(m.avg).toFixed(2)}` : '',
        m.min != null ? `min ${m.min}` : '',
        m.max != null ? `max ${m.max}` : '',
      ].filter(Boolean);
      lines.push(`  - ${m.name}: ${parts.join(', ')}`);
    }
  }
  if (insights?.categories?.top?.length) {
    const { dimension, metric, top } = insights.categories;
    lines.push(
      `top ${dimension} by ${metric}: ` +
        top.map((t) => `${t.label} (${t.value})`).join(', '),
    );
  }
  return lines.join('\n');
}

/**
 * Subagent — summarize_result. Writes a concise business-language summary using
 * ONLY metadata + approved aggregate facts (SafeInsights). It never receives raw
 * rows or customer-level values; exact numbers come from the deterministic
 * SafeInsights computed in DuckDB.
 */
@Injectable()
export class SummarizeAgentService {
  readonly agent: Agent;

  constructor(private readonly modelProvider: ModelProvider) {
    this.agent = new Agent({
      id: 'summarize_result',
      name: 'SummarizeResultAgent',
      description:
        'Write a concise business-language summary of the result from its metadata and approved ' +
        'aggregate facts. Run AFTER plan_visualization.',
      instructions: () => {
        const run = currentRun();
        const profile = run?.resultProfile;
        const base = [
          'You summarize what the query result shows, in business language.',
          'Begin your reply with ONE short sentence (e.g. "Summarizing what the data shows.").',
          'You have ONLY: the result metadata, the approved aggregate facts below, and the chosen',
          'chart type/title. You do NOT have raw rows and must never invent specific values.',
          'You MAY quote the exact numbers in the approved facts. Keep it under 3 sentences.',
          'If no rows were returned, say no matching data was found.',
          'Do NOT format any part as a markdown table.',
        ].join('\n');

        if (!profile) return base;
        const viz = run?.vizPlan;
        const vizLine = viz?.shouldVisualize
          ? `\nChosen visualization: ${viz.componentType} — "${viz.title}".`
          : '\nThe result is shown as a table.';
        return `${base}\n\n---\n\n## Result facts (metadata + approved aggregates only)\n${renderInsights(profile, run?.safeInsights)}${vizLine}`;
      },
      model: this.modelProvider.getModel() as any,
    });
  }
}
