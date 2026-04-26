/** Maps series field names to ChartContainer color slots (--color-*). */
export function chartConfigFromSeries(series: string[]) {
  return Object.fromEntries(
    series.map((key, i) => [
      key,
      { label: key, color: `var(--chart-${(i % 5) + 1})` },
    ]),
  );
}

/** Pie / radial bar: slice colors keyed by category name + value key for tooltip. */
export function chartConfigForPie(
  data: Record<string, unknown>[],
  nameKey: string,
  valueKey: string,
) {
  const out: Record<string, { label: string; color?: string }> = {
    [valueKey]: { label: valueKey },
  };
  data.forEach((row, i) => {
    const n = row[nameKey];
    if (n != null) {
      const s = String(n);
      out[s] = { label: s, color: `var(--chart-${(i % 5) + 1})` };
    }
  });
  return out;
}
