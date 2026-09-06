import { z } from "zod";

const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/;

const optionalDimension = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !/[\0\r\n]/.test(value))
    .optional();

export const overviewFiltersSchema = z
  .object({
    projectId: z.uuid(),
    from: z.date(),
    to: z.date(),
    environment: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/)
      .optional(),
    release: optionalDimension(128),
    route: optionalDimension(512),
    cursor: z.string().regex(cursorPattern).optional(),
  })
  .refine(({ from, to }) => to > from && to.getTime() - from.getTime() <= MAX_RANGE_MS, {
    message: "时间范围必须在 30 天以内",
    path: ["from"],
  });

export type OverviewFilters = z.infer<typeof overviewFiltersSchema>;

export type OverviewFilterPatch = Partial<Omit<OverviewFilters, "projectId">>;

export function defaultOverviewFilters(projectId: string, now = new Date()): OverviewFilters {
  const to = new Date(now);
  to.setUTCSeconds(0, 0);
  return overviewFiltersSchema.parse({
    projectId,
    from: new Date(to.getTime() - 24 * 60 * 60 * 1000),
    to,
  });
}

export function parseOverviewFilters(
  projectId: string,
  search: URLSearchParams,
  now = new Date(),
): OverviewFilters {
  const fallback = defaultOverviewFilters(projectId, now);
  const parsed = overviewFiltersSchema.safeParse({
    projectId,
    from: parseUTC(search.get("from")) ?? fallback.from,
    to: parseUTC(search.get("to")) ?? fallback.to,
    environment: clean(search.get("environment")),
    release: clean(search.get("release")),
    route: clean(search.get("route")),
    cursor: clean(search.get("cursor")),
  });
  return parsed.success ? parsed.data : fallback;
}

export function serializeOverviewFilters(filters: OverviewFilters): URLSearchParams {
  const valid = overviewFiltersSchema.parse(filters);
  const result = new URLSearchParams({
    from: valid.from.toISOString(),
    to: valid.to.toISOString(),
  });
  for (const [key, value] of [
    ["environment", valid.environment],
    ["release", valid.release],
    ["route", valid.route],
    ["cursor", valid.cursor],
  ] as const) {
    if (value) result.set(key, value);
  }
  return result;
}

function parseUTC(value: string | null) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clean(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
