import { useQuery } from "@tanstack/react-query";

export type WorldCountry = {
  code: string;
  /** Centre of the largest landmass, for markers and the selection label. */
  x: number;
  y: number;
  d: string;
  /** Too small for the source data: drawn as a small circle. */
  point?: boolean;
};
export type WorldMapData = { width: number; height: number; countries: WorldCountry[] };

// Country outlines are generated ahead of time (scripts/build-world-map.mjs) and loaded as
// their own chunk the first time the map is drawn, so the Console carries no geo dependency.
function loadWorldMap(): Promise<WorldMapData> {
  return import("./worldMap.json").then((module) => module.default as WorldMapData);
}

export function useWorldMap() {
  return useQuery({
    queryKey: ["world-map"],
    queryFn: loadWorldMap,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
