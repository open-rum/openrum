import { Mercator } from "@visx/geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import topology from "world-atlas/countries-110m.json";

const worldTopology = topology as unknown as Topology<{ countries: GeometryCollection }>;
const collection = feature(worldTopology, worldTopology.objects.countries) as FeatureCollection;

export function WorldMap({ focus = "156" }: { focus?: string }) {
  const width = 300;
  const height = 140;

  return (
    <svg
      className="world-map"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="按页面浏览量展示的国家分布，当前突出中国"
    >
      <Mercator<Feature<Geometry>>
        data={collection.features as Feature<Geometry>[]}
        scale={49}
        translate={[width / 2, height / 1.42]}
      >
        {(mercator) =>
          mercator.features.map(({ feature: geoFeature, path }, index) => {
            const isFocus = String(geoFeature.id) === focus;
            return (
              <path
                key={`${geoFeature.id ?? "country"}-${index}`}
                d={path || ""}
                fill={isFocus ? "var(--ds-brand)" : "var(--ds-brand-soft)"}
                stroke="var(--ds-surface)"
                strokeWidth={0.45}
              />
            );
          })
        }
      </Mercator>
    </svg>
  );
}
