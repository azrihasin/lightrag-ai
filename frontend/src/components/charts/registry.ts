import type { ComponentType } from "react"

const chartCategoryOrder = [
  "area",
  "bar",
  "line",
  "pie",
  "radar",
  "radial",
  "tooltip",
] as const

type ChartCategory = (typeof chartCategoryOrder)[number]

type ChartModule = {
  description?: string
  [key: string]: unknown
}

export type ChartGalleryEntry = {
  id: string
  slug: string
  category: ChartCategory
  title: string
  description: string | undefined
  Component: ComponentType
}

type MaybeChartGalleryEntry = ChartGalleryEntry | null

const chartModules = import.meta.glob<ChartModule>("../chart-*.tsx", {
  eager: true,
})

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatChartTitle(slug: string) {
  const [category, ...variantParts] = slug.split("-")

  if (variantParts.length === 0) {
    return toTitleCase(category)
  }

  return `${toTitleCase(category)} - ${variantParts
    .map((part) => toTitleCase(part))
    .join(" ")}`
}

function getComponentExport(module: ChartModule) {
  const componentEntry = Object.entries(module).find(
    ([exportName, value]) =>
      exportName.startsWith("Chart") && typeof value === "function"
  )

  return componentEntry?.[1] as ComponentType | undefined
}

export const chartGallery: ChartGalleryEntry[] = (
  Object.entries(chartModules).map(([path, module]) => {
    const fileName = path.split("/").pop()
    const slug = fileName?.replace(".tsx", "").replace(/^chart-/, "")
    const component = getComponentExport(module)

    if (!slug || !component) {
      return null
    }

    const [category] = slug.split("-")

    if (!chartCategoryOrder.includes(category as ChartCategory)) {
      return null
    }

    return {
      id: `chart-${slug}`,
      slug,
      category: category as ChartCategory,
      title: formatChartTitle(slug),
      description: module.description,
      Component: component,
    }
  }) as MaybeChartGalleryEntry[]
)
  .filter((chart): chart is ChartGalleryEntry => chart !== null)
  .sort((left, right) => {
    const categoryDelta =
      chartCategoryOrder.indexOf(left.category) -
      chartCategoryOrder.indexOf(right.category)

    if (categoryDelta !== 0) {
      return categoryDelta
    }

    return left.title.localeCompare(right.title)
  })

export const chartCategorySummary = chartCategoryOrder.map((category) => ({
  category,
  label: toTitleCase(category),
  count: chartGallery.filter((chart) => chart.category === category).length,
}))
