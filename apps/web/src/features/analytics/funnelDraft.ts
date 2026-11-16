import { z } from "zod";
import type { BehaviorDimension, FunnelDefinition } from "@/lib/api/analytics";

const builderSchema = z.object({
  dimension: z
    .string()
    .max(137)
    .refine(
      (value) =>
        ["country", "device", "browser", "source"].includes(value) || value.startsWith("property:"),
    ),
  windowSeconds: z.union([z.literal(1800), z.literal(3600), z.literal(86400)]),
  steps: z
    .array(
      z.object({
        kind: z.enum(["page_view", "navigation", "click", "custom"]),
        name: z.string().min(1).max(128),
      }),
    )
    .min(2)
    .max(5),
});
const savedSchema = z.object({ draft: builderSchema, applied: builderSchema.nullable() });
type Builder = Pick<FunnelDefinition, "dimension" | "windowSeconds" | "steps">;

export function readFunnelDraft(
  projectId: string,
): { draft: Builder; applied: Builder | null } | undefined {
  try {
    const result = savedSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`openrum:funnel:${projectId}`) ?? "null"),
    );
    if (!result.success) return undefined;
    const builder = (value: z.infer<typeof builderSchema>): Builder => ({
      ...value,
      dimension: value.dimension as BehaviorDimension,
    });
    return {
      draft: builder(result.data.draft),
      applied: result.data.applied ? builder(result.data.applied) : null,
    };
  } catch {
    return undefined;
  }
}

export function rememberFunnelDraft(projectId: string, draft: Builder, applied: Builder | null) {
  try {
    sessionStorage.setItem(
      `openrum:funnel:${projectId}`,
      JSON.stringify({
        draft: builderSchema.parse(draft),
        applied: applied ? builderSchema.parse(applied) : null,
      }),
    );
  } catch {
    /* Storage may be unavailable; the current in-memory draft still works. */
  }
}
