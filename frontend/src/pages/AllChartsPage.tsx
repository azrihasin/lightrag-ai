import { ChartGalleryItem } from "@/components/charts/ChartGalleryItem"
import {
  chartCategorySummary,
  chartGallery,
} from "@/components/charts/registry"

export default function AllChartsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8 p-4 md:p-6">
        <section className="space-y-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">All Charts</h1>
            <p className="text-sm text-muted-foreground">
              Browse all {chartGallery.length} official shadcn chart collection
              blocks installed in this frontend.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {chartCategorySummary.map((item) => (
              <span
                key={item.category}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                {item.label}: {item.count}
              </span>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {chartGallery.map((chart) => (
            <ChartGalleryItem key={chart.id} chart={chart} />
          ))}
        </section>
      </div>
    </div>
  )
}
