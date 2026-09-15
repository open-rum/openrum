import { useState } from "react";
import { NaturalEarth } from "@visx/geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import topology from "world-atlas/countries-50m.json";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { countryNumericCodes } from "./world-map/countryCodes";
import {
  countryFill,
  countryMapLabel,
  mapCountryValues,
  type CountryValue,
} from "./world-map/data";

const worldTopology = topology as unknown as Topology<{ countries: GeometryCollection }>;
const collection = feature(worldTopology, worldTopology.objects.countries) as FeatureCollection;
const worldFeature: Feature<Geometry> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "GeometryCollection",
    geometries: collection.features.map((item) => item.geometry),
  },
};
const featureID = (item: Feature) =>
  String(item.id ?? (item.properties?.name === "Kosovo" ? "XK" : ""));
const available = new Set(collection.features.map(featureID).filter(Boolean));
const countryCodes = new Map(Object.entries(countryNumericCodes).map(([code, id]) => [id, code]));
countryCodes.set("XK", "XK");
const width = 600;
const height = 300;
const extent: [[number, number], [number, number]] = [
  [8, 8],
  [width - 8, height - 8],
];

export function WorldMap({
  data,
  title,
  metricLabel,
  formatValue,
}: {
  data: CountryValue[];
  title: string;
  metricLabel: string;
  formatValue: (value: number) => string;
}) {
  const { mapped, unmapped } = mapCountryValues(data, available);
  const maximum = Math.max(0, ...[...mapped.values()].map((entry) => entry.value));

  return (
    <div className="dashboard-world-map flex min-w-0 flex-col gap-3">
      <TooltipProvider>
        <svg
          className="dashboard-world-map-canvas"
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`${title} 世界地图`}
        >
          <NaturalEarth<Feature<Geometry>>
            data={collection.features}
            fitExtent={[extent, worldFeature]}
            digits={2}
          >
            {({ features, path: geoPath }) =>
              features
                .map((item, index) => ({
                  ...item,
                  index,
                  marker:
                    mapped.has(featureID(item.feature)) && geoPath.area(item.feature) < 12
                      ? item.centroid
                      : undefined,
                }))
                // Paint small-country markers last so neighbouring land cannot
                // intercept their pointer/touch targets (notably Singapore).
                .sort((a, b) => Number(Boolean(a.marker)) - Number(Boolean(b.marker)))
                .map(({ feature: item, path, marker, index }) => {
                  const id = featureID(item);
                  const entry = mapped.get(id);
                  const code = countryCodes.get(id);
                  const label = entry
                    ? countryMapLabel(entry.code)
                    : code
                      ? countryMapLabel(code)
                      : String(item.properties?.name ?? "未识别地区");
                  return (
                    <CountryShape
                      key={`${id}-${index}`}
                      id={id}
                      path={path ?? ""}
                      label={label}
                      value={entry?.value}
                      fill={countryFill(entry?.value, maximum)}
                      marker={marker}
                      metricLabel={metricLabel}
                      formatValue={formatValue}
                    />
                  );
                })
            }
          </NaturalEarth>
        </svg>
      </TooltipProvider>
      <div className="dashboard-map-legend text-xs text-muted-foreground" aria-label="地图图例">
        <span>{metricLabel}</span>
        <span className="flex items-center gap-2">
          <span>0</span>
          <span className="dashboard-map-scale" aria-hidden="true" />
          <span>{formatValue(maximum)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <i className="dashboard-map-no-data" aria-hidden="true" />
          未返回数据
        </span>
      </div>
      {unmapped.length > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          {unmapped.length} 个分组未定位（未知代码或底图未收录），数值保留在详情数据表中。
        </p>
      ) : null}
    </div>
  );
}

function CountryShape({
  id,
  path,
  label,
  value,
  fill,
  marker,
  metricLabel,
  formatValue,
}: {
  id: string;
  path: string;
  label: string;
  value?: number;
  fill: string;
  marker?: [number, number];
  metricLabel: string;
  formatValue: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const close = () => {
    setPinned(false);
    setOpen(false);
  };
  const shape = (
    <>
      <path d={path} fill={fill} />
      {marker ? <circle cx={marker[0]} cy={marker[1]} r={4} fill={fill} /> : null}
    </>
  );
  if (value === undefined)
    return (
      <g className="dashboard-map-country" data-country-id={id}>
        <title>{label} · 未返回数据</title>
        {shape}
      </g>
    );
  const valueLabel = formatValue(value);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!pinned) setOpen(next);
      }}
    >
      <TooltipTrigger asChild>
        <g
          className="dashboard-map-country"
          data-country-id={id}
          data-has-value
          role="button"
          tabIndex={0}
          aria-label={`${label} · ${metricLabel} ${valueLabel}`}
          onClick={(event) => {
            event.preventDefault();
            // Touch emits pointerleave after a tap. Keep that tap's value open
            // until another tap, an outside interaction, blur or Escape.
            setPinned(!pinned);
            setOpen(!pinned);
          }}
          onBlur={close}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {shape}
        </g>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        onEscapeKeyDown={close}
        onPointerDownOutside={close}
      >
        <span>{label}</span>
        <span>{metricLabel}</span>
        <strong className="tabular-nums">{valueLabel}</strong>
      </TooltipContent>
    </Tooltip>
  );
}
