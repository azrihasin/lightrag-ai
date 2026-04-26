import type { ChartGalleryEntry } from "./registry"

type ChartGalleryItemProps = {
  chart: ChartGalleryEntry
}

export function ChartGalleryItem({ chart }: ChartGalleryItemProps) {
  const ChartComponent = chart.Component

  return (
    <section className="flex h-full flex-col gap-3">
      <header className="space-y-1 px-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {chart.category}
        </p>
        <h2 className="text-base font-semibold leading-tight">{chart.title}</h2>
        {chart.description ? (
          <p className="text-sm text-muted-foreground">{chart.description}</p>
        ) : null}
      </header>
      <div className="flex-1 [&>*]:h-full [&_[data-chart]]:min-h-[240px]">
        <ChartComponent />
      </div>
    </section>
  )
}
