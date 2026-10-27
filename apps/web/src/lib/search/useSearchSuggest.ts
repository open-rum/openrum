import { useCallback } from "react";
import type { SearchQueryField, SearchQueryOption } from "@/components/filters/SearchQueryInput";
import { getSearchValues, type SearchDataset } from "@/lib/api/search";

/**
 * A `suggest` for SearchQueryInput that asks the server for a field's common values in the
 * page's range. Fields that are not part of the search language get nothing.
 */
export function useSearchSuggest({
  projectId,
  dataset,
  from,
  to,
  environment,
  event,
  label = (_field, value) => value,
}: {
  projectId: string;
  dataset: SearchDataset;
  from: Date;
  to: Date;
  environment?: string;
  event?: string;
  label?: (field: SearchQueryField, value: string) => string;
}) {
  const fromTime = from.getTime();
  const toTime = to.getTime();
  return useCallback(
    async (
      field: SearchQueryField,
      contains: string,
      signal: AbortSignal,
    ): Promise<SearchQueryOption[]> => {
      const { values } = await getSearchValues(
        {
          projectId,
          dataset,
          field: field.term ?? field.key,
          contains,
          from: new Date(fromTime),
          to: new Date(toTime),
          environment,
          event,
        },
        signal,
      );
      return values.map((item) => ({
        value: item.value,
        label: label(field, item.value),
        count: item.count,
        countLabel: "次",
      }));
    },
    // label is a formatting function; a new identity each render must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, dataset, fromTime, toTime, environment, event],
  );
}
