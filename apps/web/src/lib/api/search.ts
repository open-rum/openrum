import { z } from "zod";
import type { SearchQueryError } from "@/components/filters/SearchQueryInput";
import { HTTPError } from "@/lib/auth/session";
import { searchErrorMessage } from "@/lib/search/terms";
import { requestJSON } from "./client";

/** The pages whose search the server can suggest values for. */
export type SearchDataset = "logs" | "issues" | "sessions" | "apis" | "events";

const searchValuesSchema = z.object({
  values: z.array(z.object({ value: z.string(), count: z.number().int().nonnegative() })),
});

export type SearchValueRequest = {
  projectId: string;
  dataset: SearchDataset;
  /** A search field, attributes.<name>, or "attributes" for the property names. */
  field: string;
  contains?: string;
  from: Date;
  to: Date;
  environment?: string;
  /** Narrows the Events dataset to one custom event. */
  event?: string;
};

export function getSearchValues(request: SearchValueRequest, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    dataset: request.dataset,
    field: request.field,
    from: request.from.toISOString(),
    to: request.to.toISOString(),
  });
  if (request.contains) parameters.set("contains", request.contains);
  if (request.environment) parameters.set("environment", request.environment);
  if (request.event) parameters.set("event", request.event);
  return requestJSON(
    searchValuesSchema,
    `/api/v1/projects/${encodeURIComponent(request.projectId)}/search/values?${parameters.toString()}`,
    { signal },
  );
}

const searchErrorSchema = z.object({
  error: z.object({
    code: z.literal("INVALID_SEARCH"),
    search: z.object({ code: z.string(), position: z.number(), term: z.string().optional() }),
  }),
});

/** A search the server refused, with where it went wrong; undefined for any other error. */
export function searchErrorFrom(error: unknown): SearchQueryError | undefined {
  if (!(error instanceof HTTPError) || error.code !== "INVALID_SEARCH") return undefined;
  const parsed = searchErrorSchema.safeParse(error.body);
  if (!parsed.success) return { message: searchErrorMessage(undefined) };
  const detail = parsed.data.error.search;
  return {
    message: searchErrorMessage(detail.code, detail.term),
    position: detail.term ? detail.position : undefined,
    term: detail.term,
  };
}
