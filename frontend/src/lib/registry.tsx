"use client";

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { chartConfigForPie, chartConfigFromSeries } from "./chart-registry-helpers";
import { useState } from "react";
import { GeoMapRenderer } from "@/components/geo-map-renderer";
import { TrendingUp } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  Rectangle,
  Sector,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export const { registry } = defineRegistry(catalog, {
  components: {
    WeatherCard: ({ props }: any) => {
      const unit = props.unit ?? "celsius";
      const tempLabel = unit === "fahrenheit" ? "°F" : "°C";

      return (
        <div className="rounded-lg border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{props.location}</h3>
              <p className="mt-1 text-3xl font-bold">
                {props.temperature}
                {tempLabel}
              </p>
              <p className="capitalize text-gray-600">{props.condition}</p>
            </div>
            {(props.humidity != null || props.windSpeed != null) && (
              <div className="space-y-0.5 text-sm text-gray-600">
                {props.humidity != null && <p>Humidity: {props.humidity}%</p>}
                {props.windSpeed != null && <p>Wind: {props.windSpeed}</p>}
              </div>
            )}
          </div>
        </div>
      );
    },
    LineChart: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },

    BarChart: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={4} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    AlertDialog: ({ props }: any) => {
      const [open, setOpen] = useState(false);
      const confirmLabel = props.confirmLabel ?? "Continue";
      const cancelLabel = props.cancelLabel ?? "Cancel";
      const isDestructive = props.variant === "destructive";

      return (
        <AlertDialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <AlertDialogPrimitive.Trigger asChild>
            <button
              className={
                isDestructive
                  ? "inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  : "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              }
            >
              {props.triggerLabel}
            </button>
          </AlertDialogPrimitive.Trigger>
          <AlertDialogPrimitive.Portal>
            <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <AlertDialogPrimitive.Content className="bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:rounded-lg">
              <div className="flex flex-col space-y-2 text-center sm:text-left">
                <AlertDialogPrimitive.Title className="text-lg font-semibold">
                  {props.title}
                </AlertDialogPrimitive.Title>
                {props.description && (
                  <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
                    {props.description}
                  </AlertDialogPrimitive.Description>
                )}
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
                <AlertDialogPrimitive.Cancel className="mt-2 inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:mt-0">
                  {cancelLabel}
                </AlertDialogPrimitive.Cancel>
                <AlertDialogPrimitive.Action
                  className={
                    isDestructive
                      ? "inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      : "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  }
                >
                  {confirmLabel}
                </AlertDialogPrimitive.Action>
              </div>
            </AlertDialogPrimitive.Content>
          </AlertDialogPrimitive.Portal>
        </AlertDialogPrimitive.Root>
      );
    },
    ChartAreaDefault: ({ props }: any) => {
      const { data, xKey, series, title, description, footerLabel } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    fill={`var(--color-${key})`}
                    fillOpacity={0.4}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-sm">
            <div className="flex gap-2 font-medium leading-none">
              {footerLabel ?? "Trending up by 5.2% this month"}
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="leading-none text-muted-foreground">
              Showing total visitors for the last 6 months
            </div>
          </CardFooter>
        </Card>
      );
    },
    ChartAreaAxes: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Area Chart with Axes"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={10} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                {series.map((key: string, i: number) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    fill={`var(--color-${key})`}
                    fillOpacity={i === 0 ? 0.35 : 0.25}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaGradient: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Gradient Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <defs>
                  {series.map((key: string) => (
                    <linearGradient key={key} id={`fill-${key}-gradient`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.1} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    fill={`url(#fill-${key}-gradient)`}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaIcons: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Area Chart with Legend"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((key: string, i: number) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    fill={`var(--color-${key})`}
                    fillOpacity={i === 0 ? 0.4 : 0.25}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaLegend: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Area Chart Legend"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    fill={`var(--color-${key})`}
                    fillOpacity={0.35}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaLinear: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Linear Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="linear"
                    fill={`var(--color-${key})`}
                    fillOpacity={0.3}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaStacked: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Stacked Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    stackId="a"
                    fill={`var(--color-${key})`}
                    fillOpacity={0.4}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaStackedExpand: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Expanded Stacked Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart
                accessibilityLayer
                data={data}
                margin={{ left: 12, right: 12 }}
                stackOffset="expand"
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="natural"
                    stackId="a"
                    fill={`var(--color-${key})`}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartAreaStep: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Step Area Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <AreaChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                {series.map((key: string) => (
                  <Area
                    key={key}
                    dataKey={key}
                    type="step"
                    fill={`var(--color-${key})`}
                    fillOpacity={0.35}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarDefault: ({ props }: any) => {
      const { data, xKey, series, title, description, footerLabel } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={8} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-sm">
            <div className="flex gap-2 font-medium leading-none">
              {footerLabel ?? "Trending up by 5.2% this month"}
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="leading-none text-muted-foreground">
              Showing total visitors for the last 6 months
            </div>
          </CardFooter>
        </Card>
      );
    },
    ChartBarActive: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const vKey = series[0];
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Active Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar
                  dataKey={vKey}
                  fill={`var(--color-${vKey})`}
                  radius={8}
                  shape={({ index, ...shapeProps }) =>
                    index === 0 ? (
                      <Rectangle
                        {...shapeProps}
                        stroke={`var(--color-${vKey})`}
                        strokeDasharray="4 4"
                        fillOpacity={0.8}
                        radius={8}
                      />
                    ) : (
                      <Rectangle {...shapeProps} radius={8} />
                    )
                  }
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarHorizontal: ({ props }: any) => {
      const { data, xKey, series } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{props.title ?? "Horizontal Bar Chart"}</CardTitle>
            {props.description != null && props.description !== "" && (
              <CardDescription>{props.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid horizontal={false} />
                <YAxis
                  dataKey={xKey}
                  type="category"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  width={70}
                />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={8} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarLabel: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Bar Chart with Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={8}>
                    <LabelList position="top" className="fill-foreground text-xs" offset={8} />
                  </Bar>
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarLabelCustom: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Bar Chart with Inside Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={8}>
                    <LabelList position="insideTop" className="fill-background text-xs" offset={12} />
                  </Bar>
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarMixed: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const vKey = series[0];
      const chartConfig = chartConfigFromSeries(series);
      const cellColors = [
        "var(--chart-1)",
        "var(--chart-2)",
        "var(--chart-3)",
        "var(--chart-4)",
        "var(--chart-5)",
        "var(--chart-1)",
      ];
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Mixed Color Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey={vKey} radius={8}>
                  {data.map((item: Record<string, unknown>, index: number) => (
                    <Cell
                      key={`${String(item[xKey])}-${index}`}
                      fill={cellColors[index % cellColors.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarMultiple: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Multiple Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={8} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarStacked: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Stacked Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((key: string) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={`var(--color-${key})`} radius={8} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartBarNegative: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const vKey = series[0];
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Negative Bar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <YAxis hide />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel hideIndicator />}
                />
                <Bar dataKey={vKey} radius={8}>
                  <LabelList
                    dataKey={xKey}
                    position="top"
                    className="fill-foreground text-xs"
                  />
                  {data.map((item: Record<string, unknown>, index: number) => (
                    <Cell
                      key={`${String(item[xKey])}-${index}`}
                      fill={Number(item[vKey]) >= 0 ? "var(--chart-1)" : "var(--chart-2)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineDefault: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineDots: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart with Dots"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineDotsColors: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart with Colored Dots"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string, i: number) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={{
                      fill: `var(--chart-${((i + 1) % 5) + 1})`,
                      strokeWidth: 2,
                      r: 4,
                    }}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineDotsCustom: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart with Custom Dots"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={{ fill: `var(--color-${key})`, r: 4, strokeWidth: 2 }}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineLabel: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart with Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  >
                    <LabelList position="top" className="fill-foreground text-xs" offset={8} />
                  </Line>
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineLabelCustom: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Line Chart with Inside Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  >
                    <LabelList position="insideTop" className="fill-foreground text-xs" offset={8} />
                  </Line>
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineLinear: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Linear Line Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="linear"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineMultiple: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Multiple Line Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="natural"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartLineStep: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Step Line Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(value) => String(value).slice(0, 3)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                {series.map((key: string) => (
                  <Line
                    key={key}
                    dataKey={key}
                    type="step"
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieSimple: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieDonut: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Donut Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={60} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieDonutActive: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Active Donut Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={data}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  innerRadius={60}
                  shape={({ index, outerRadius = 0, ...entry }) =>
                    index === 0 ? (
                      <Sector {...entry} outerRadius={outerRadius + 10} />
                    ) : (
                      <Sector {...entry} outerRadius={outerRadius} />
                    )
                  }
                />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieDonutText: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      const total = (data as Record<string, unknown>[]).reduce(
        (sum, item) => sum + Number(item[valueKey]),
        0,
      );
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Donut Chart with Text"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={60} strokeWidth={5}>
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                              {total.toLocaleString()}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 24}
                              className="fill-muted-foreground text-sm"
                            >
                              {valueKey}
                            </tspan>
                          </text>
                        );
                      }
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieLabel: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart with Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} label />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieLabelCustom: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart with Custom Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={40} label />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieLabelList: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart Label List"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey}>
                  <LabelList dataKey={nameKey} className="fill-background text-xs" stroke="none" />
                </Pie>
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieLegend: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart with Legend"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={50} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieSeparatorNone: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Pie Chart Without Separators"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={60} strokeWidth={0} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartPieStacked: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      const rows = data as Record<string, unknown>[];
      const inner = rows.slice(0, Math.ceil(rows.length / 2));
      const outer = rows.slice(Math.ceil(rows.length / 2));
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Stacked Pie Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={inner} dataKey={valueKey} nameKey={nameKey} outerRadius={60} />
                <Pie
                  data={outer.length > 0 ? outer : inner}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  innerRadius={70}
                  outerRadius={90}
                />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarDefault: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarDots: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Chart with Dots"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.55}
                    stroke={`var(--color-${key})`}
                    dot={{ fill: `var(--color-${key})`, r: 4 }}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridCircle: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Circle Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid gridType="circle" />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridCircleFill: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Filled Circle Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid gridType="circle" className="first:fill-muted/50 last:fill-background" />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridCircleNoLines: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Circle Grid Without Lines"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid gridType="circle" radialLines={false} />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridCustom: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Custom Radar Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid strokeDasharray="3 3" />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.55}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridFill: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Filled Radar Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid className="first:fill-muted/50 last:fill-background" />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarGridNone: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Chart Without Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarIcons: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Chart with Legend"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string, i: number) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={i === 0 ? 0.45 : 0.3}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarLabelCustom: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Chart Custom Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarLegend: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Legend Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string, i: number) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={i === 0 ? 0.45 : 0.3}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarLinesOnly: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Lines Only"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarMultiple: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Multiple Radar Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                {series.map((key: string, i: number) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={i === 0 ? 0.45 : 0.3}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadarRadius: ({ props }: any) => {
      const { data, angleKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader className="items-center pb-4">
            <CardTitle>{title ?? "Radar Radius Axis"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadarChart data={data}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid />
                <PolarAngleAxis dataKey={angleKey} />
                <PolarRadiusAxis angle={60} tickLine={false} axisLine={false} />
                {series.map((key: string) => (
                  <Radar
                    key={key}
                    dataKey={key}
                    fill={`var(--color-${key})`}
                    fillOpacity={0.6}
                    stroke={`var(--color-${key})`}
                  />
                ))}
              </RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialSimple: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Radial Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadialBarChart data={data} innerRadius={30} outerRadius={110}>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey={nameKey} />}
                />
                <RadialBar dataKey={valueKey} background />
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialGrid: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Radial Chart with Grid"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadialBarChart data={data} innerRadius={30} outerRadius={110}>
                <PolarGrid gridType="circle" radialLines={false} stroke="none" />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey={nameKey} />}
                />
                <RadialBar dataKey={valueKey} background />
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialLabel: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Radial Chart with Labels"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadialBarChart data={data} innerRadius={30} outerRadius={110}>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey={nameKey} />}
                />
                <RadialBar dataKey={valueKey} background>
                  <LabelList
                    position="insideStart"
                    dataKey={nameKey}
                    className="fill-white text-xs capitalize mix-blend-luminosity"
                  />
                </RadialBar>
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialShape: ({ props }: any) => {
      const { data, nameKey, valueKey, title, description } = props;
      const chartConfig = chartConfigForPie(data as Record<string, unknown>[], nameKey, valueKey);
      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{title ?? "Rounded Radial Chart"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadialBarChart data={data} innerRadius={30} outerRadius={110}>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey={nameKey} />}
                />
                <RadialBar dataKey={valueKey} background cornerRadius={10} />
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialStacked: ({ props }: any) => {
      const desktop = props.desktop ?? 1260;
      const mobile = props.mobile ?? 570;
      const total = desktop + mobile;
      const chartData = [{ desktop, mobile }];
      const chartConfig = {
        desktop: { label: "Desktop", color: "var(--chart-1)" },
        mobile: { label: "Mobile", color: "var(--chart-2)" },
      };

      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{props.title ?? "Stacked Radial Chart"}</CardTitle>
            {props.description != null && props.description !== "" && (
              <CardDescription>{props.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex flex-1 items-center pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square w-full max-w-[250px]">
              <RadialBarChart data={chartData} endAngle={180} innerRadius={80} outerRadius={110}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) - 16}
                              className="fill-foreground text-2xl font-bold"
                            >
                              {total.toLocaleString()}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 4}
                              className="fill-muted-foreground text-sm"
                            >
                              Total
                            </tspan>
                          </text>
                        );
                      }
                    }}
                  />
                </PolarRadiusAxis>
                <RadialBar
                  dataKey="mobile"
                  fill="var(--color-mobile)"
                  stackId="a"
                  cornerRadius={5}
                  className="stroke-transparent stroke-2"
                />
                <RadialBar
                  dataKey="desktop"
                  fill="var(--color-desktop)"
                  stackId="a"
                  cornerRadius={5}
                  className="stroke-transparent stroke-2"
                />
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartRadialText: ({ props }: any) => {
      const value = props.value ?? 1260;
      const label = props.label ?? "Visitors";
      const chartData = [{ value, fill: "var(--color-value)" }];
      const chartConfig = {
        value: { label, color: "var(--chart-1)" },
      };

      return (
        <Card className="flex flex-col">
          <CardHeader className="items-center pb-0">
            <CardTitle>{props.title ?? "Radial Text Chart"}</CardTitle>
            {props.description != null && props.description !== "" && (
              <CardDescription>{props.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex-1 pb-0">
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
              <RadialBarChart data={chartData} startAngle={0} endAngle={250} outerRadius={90} innerRadius={80}>
                <PolarGrid
                  gridType="circle"
                  radialLines={false}
                  stroke="none"
                  className="first:fill-muted last:fill-background"
                  polarRadius={[90, 80]}
                />
                <RadialBar dataKey="value" background cornerRadius={10} />
                <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-4xl font-bold">
                              {value.toLocaleString()}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 24}
                              className="fill-muted-foreground text-sm"
                            >
                              {label}
                            </tspan>
                          </text>
                        );
                      }
                    }}
                  />
                </PolarRadiusAxis>
              </RadialBarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipDefault: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Default"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipAdvanced: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Advanced"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      className="w-[180px]"
                      formatter={(value, name, item, index) => {
                        const payload = item.payload as Record<string, unknown>;
                        const rowTotal = series.reduce(
                          (s: number, k: string) => s + (Number(payload[k]) || 0),
                          0,
                        );
                        return (
                          <>
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{ background: `var(--color-${name})` }}
                            />
                            {(name != null
                              ? (chartConfig as Record<string, { label: string }>)[name as string]
                              : undefined
                            )?.label ?? name}
                            <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium text-foreground tabular-nums">
                              {value}
                              <span className="font-normal text-muted-foreground">kcal</span>
                            </div>
                            {index === series.length - 1 && (
                              <div className="mt-1.5 flex basis-full items-center border-t pt-1.5 text-xs font-medium text-foreground">
                                Total
                                <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium text-foreground tabular-nums">
                                  {rowTotal}
                                  <span className="font-normal text-muted-foreground">kcal</span>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      }}
                    />
                  }
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipFormatter: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Formatter"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, name) => (
                        <div className="flex min-w-[130px] items-center text-xs text-muted-foreground">
                          {(name != null
                            ? (chartConfig as Record<string, { label: string }>)[name]
                            : undefined
                          )?.label ?? name}
                          <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium text-foreground tabular-nums">
                            {value}
                            <span className="font-normal text-muted-foreground">kcal</span>
                          </div>
                        </div>
                      )}
                    />
                  }
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipIcons: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Icons"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipIndicatorLine: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Line Indicator"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipIndicatorNone: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - No Indicator"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipLabelCustom: ({ props }: any) => {
      const { data, xKey, series, title, description, tooltipLabelKey } = props;
      const chartConfig = {
        ...chartConfigFromSeries(series),
        ...(tooltipLabelKey != null && tooltipLabelKey !== ""
          ? { [tooltipLabelKey]: { label: tooltipLabelKey } }
          : {}),
      };
      const labelKey = tooltipLabelKey != null && tooltipLabelKey !== "" ? tooltipLabelKey : xKey;
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Custom Label"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent labelKey={labelKey} indicator="line" />}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipLabelFormatter: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - Label Formatter"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) =>
                        new Date(value).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      }
                    />
                  }
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },
    ChartTooltipLabelNone: ({ props }: any) => {
      const { data, xKey, series, title, description } = props;
      const chartConfig = chartConfigFromSeries(series);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title ?? "Tooltip - No Label"}</CardTitle>
            {description != null && description !== "" && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <BarChart accessibilityLayer data={data}>
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  tickFormatter={(value) =>
                    new Date(value).toLocaleDateString("en-US", { weekday: "short" })
                  }
                />
                {series.map((key: string, i: number) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={`var(--color-${key})`}
                    radius={
                      series.length === 1
                        ? 4
                        : i === 0
                          ? [0, 0, 4, 4]
                          : i === series.length - 1
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                    }
                  />
                ))}
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator hideLabel />} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      );
    },

    GeoMap: ({ props }: any) => <GeoMapRenderer props={props} />,
  },
  actions: {
    submit: async (params) => {
      console.log("Submit:", params);
    },
    navigate: async (params) => {
      console.log("Navigate:", params);
    },
  },
});
