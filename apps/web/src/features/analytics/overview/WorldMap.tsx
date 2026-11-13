import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { intensityLevel, levelOpacity } from "./overviewData";
import { useWorldMap } from "./worldMapData";

export type MapMarker = { code: string; weight: number };

/**
 * A choropleth of country outlines. Pointing at a country shows `describe(code)` beside the
 * pointer; clicking a country with data selects it. The ranking beside the map is the
 * keyboard path to the same selection, so the outlines themselves are not tab stops.
 */
export function WorldMap({
  values,
  selected,
  markers = [],
  label,
  onSelect,
  describe,
}: {
  /** Country code to the value the map is coloured by. */
  values: ReadonlyMap<string, number>;
  selected?: string | null;
  /** Pulsing rings, sized by weight (0–1). */
  markers?: MapMarker[];
  label: string;
  onSelect?: (code: string) => void;
  describe: (code: string) => ReactNode;
}) {
  const world = useWorldMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    code: string;
    x: number;
    y: number;
    side: "left" | "right";
  } | null>(null);
  const max = Math.max(0, ...values.values());
  const data = world.data;
  const byCode = new Map(data?.countries.map((country) => [country.code, country]));
  const selectedCountry = selected ? byCode.get(selected) : undefined;
  const hovered = hover ? byCode.get(hover.code) : undefined;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const code = (event.target as Element).closest("[data-country]")?.getAttribute("data-country");
    const box = containerRef.current?.getBoundingClientRect();
    if (!code || !box) {
      setHover(null);
      return;
    }
    const x = event.clientX - box.left;
    // Near the right edge the label flips to the pointer's left.
    setHover({
      code,
      x,
      y: event.clientY - box.top,
      side: x / box.width > 0.68 ? "left" : "right",
    });
  }

  return (
    <div ref={containerRef} className="overview-map relative">
      <svg
        viewBox={`0 0 ${data?.width ?? 1000} ${data?.height ?? 438}`}
        role="img"
        aria-label={label}
        className="block w-full overflow-visible"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        {data?.countries.map((country) => {
          const level = intensityLevel(values.get(country.code) ?? 0, max);
          const isSelected = country.code === selected;
          return (
            <path
              key={country.code}
              d={country.d}
              data-country={country.code}
              data-level={level}
              fill={
                isSelected
                  ? "var(--color-accent)"
                  : level
                    ? "var(--color-primary)"
                    : "var(--color-base-300)"
              }
              fillOpacity={isSelected || !level ? 1 : levelOpacity[level]}
              stroke="var(--color-base-100)"
              strokeWidth={0.6}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className={level && onSelect ? "cursor-pointer" : undefined}
              onClick={level && onSelect ? () => onSelect(country.code) : undefined}
            />
          );
        })}
        {/* The pointed-at outline is drawn again on top so its border is never covered. */}
        {hovered ? (
          <path
            d={hovered.d}
            fill="none"
            stroke="var(--color-base-content)"
            strokeWidth={1.25}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            aria-hidden="true"
          />
        ) : null}
        {data
          ? markers.map((marker, index) => {
              const country = byCode.get(marker.code);
              if (!country) return null;
              const radius = 5 + 12 * Math.sqrt(Math.max(0, Math.min(1, marker.weight)));
              return (
                <g key={marker.code} aria-hidden="true" pointerEvents="none">
                  <circle
                    cx={country.x}
                    cy={country.y}
                    r={radius}
                    fill="var(--color-primary)"
                    fillOpacity={0.14}
                  />
                  <circle
                    className="overview-map-pulse"
                    cx={country.x}
                    cy={country.y}
                    r={radius}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeWidth={1.5}
                    style={{ animationDelay: `${index * 0.45}s` }}
                  />
                </g>
              );
            })
          : null}
        {selectedCountry ? (
          <circle
            cx={selectedCountry.x}
            cy={selectedCountry.y}
            r={4.5}
            fill="var(--color-accent)"
            stroke="var(--color-base-100)"
            strokeWidth={2}
            pointerEvents="none"
            aria-hidden="true"
          />
        ) : null}
      </svg>
      {hover ? (
        <div
          className="overview-map-callout"
          data-side={hover.side}
          style={{ left: hover.x, top: hover.y }}
        >
          {describe(hover.code)}
        </div>
      ) : selectedCountry && data ? (
        <div
          className="overview-map-callout"
          data-side={selectedCountry.x / data.width < 0.68 ? "right" : "left"}
          style={{
            left: `${(selectedCountry.x / data.width) * 100}%`,
            top: `${(selectedCountry.y / data.height) * 100}%`,
          }}
        >
          {describe(selectedCountry.code)}
        </div>
      ) : null}
      {world.isPending ? (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-base-content/70">
          正在载入地图…
        </span>
      ) : null}
      {world.isError ? (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-base-content/70">
          地图数据载入失败
        </span>
      ) : null}
    </div>
  );
}
