"use client";

import { memo } from "react";
import {
  CloudIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  LoaderIcon,
  MapPinIcon,
  SunIcon,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

type ConditionStyle = {
  icon: React.ElementType;
  iconClass: string;
  accentClass: string;
};

function getConditionStyle(condition: string): ConditionStyle {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("shower") || c.includes("drizzle"))
    return { icon: CloudRainIcon, iconClass: "text-blue-400", accentClass: "text-blue-500" };
  if (c.includes("snow") || c.includes("blizzard") || c.includes("sleet"))
    return { icon: CloudSnowIcon, iconClass: "text-sky-300", accentClass: "text-sky-400" };
  if (c.includes("sun") || c.includes("clear"))
    return { icon: SunIcon, iconClass: "text-amber-400", accentClass: "text-amber-500" };
  if (c.includes("partly") || c.includes("partial"))
    return { icon: CloudSunIcon, iconClass: "text-orange-400", accentClass: "text-orange-500" };
  return { icon: CloudIcon, iconClass: "text-slate-400", accentClass: "text-slate-500" };
}

function formatTemp(temp: number | undefined, unit: string | undefined): string {
  if (temp === undefined || temp === null) return "—";
  if (!unit || unit === "celsius" || unit === "c") return `${temp}°C`;
  return `${temp}°F`;
}

interface WeatherData {
  location?: string;
  temperature?: number;
  condition?: string;
  unit?: string;
  humidity?: number;
  windSpeed?: string;
}

function parseArgs(argsText?: string): { location?: string } {
  try {
    if (argsText) return JSON.parse(argsText);
  } catch { /* ignore */ }
  return {};
}

function parseResult(result: unknown): WeatherData | null {
  if (!result) return null;
  const str = typeof result === "string" ? result : JSON.stringify(result);
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null) return parsed as WeatherData;
  } catch { /* ignore */ }
  return null;
}

const WeatherToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const isRunning = status?.type === "running";
  const args = parseArgs(argsText);
  const data = parseResult(result);

  const location = data?.location ?? args.location ?? "—";
  const temperature = data?.temperature;
  const condition = data?.condition ?? "";
  const unit = data?.unit;

  const { icon: WeatherIcon, iconClass, accentClass } = getConditionStyle(condition);

  if (isRunning && !data) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3 animate-pulse">
        <LoaderIcon className="size-6 shrink-0 animate-spin text-muted-foreground" />
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">{location}</div>
          <div className="text-lg font-medium text-muted-foreground">—</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <WeatherIcon className={cn("size-6 shrink-0", iconClass)} />
      <div className="flex-1 min-w-0">
        <div className={cn("flex items-center gap-1 text-xs", accentClass)}>
          <MapPinIcon className="size-3 shrink-0" />
          <span className="truncate">{location}</span>
        </div>
        <div className="text-lg font-medium leading-tight">
          {formatTemp(temperature, unit)}
        </div>
      </div>
      {condition && (
        <div className={cn("shrink-0 text-sm", accentClass)}>{condition}</div>
      )}
    </div>
  );
};

export const WeatherTool = memo(WeatherToolImpl);
WeatherTool.displayName = "WeatherTool";
