import { CodeXmlIcon, LinkIcon, PackageIcon, RouteIcon } from "lucide-react";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
} from "@/components/filters/SearchQueryInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  apiMethods,
  apiSortLabels,
  apiSorts,
  type APIFilters,
  type APIsResponse,
} from "@/lib/api/apis";
import { useSearchSuggest } from "@/lib/search/useSearchSuggest";

type Facets = APIsResponse["facets"];

/** The API list's search and sort. The search holds every condition as text in `q`. */
export function ApiFilterBar({
  filters,
  facets,
  error,
  onChange,
}: {
  filters: APIFilters;
  facets?: Facets;
  /** Why the server refused the search, if it did. */
  error?: SearchQueryError;
  onChange: (patch: Partial<APIFilters>) => void;
}) {
  const suggest = useSearchSuggest({
    projectId: filters.projectId,
    dataset: "apis",
    from: filters.from,
    to: filters.to,
    environment: filters.environment,
  });
  return (
    <>
      <SearchQueryInput
        ariaLabel="搜索 API"
        placeholder="搜索 endpoint，或输入条件，例如 method:[POST,PUT] AND endpoint:*pay*"
        value={filters.q ?? ""}
        onSubmit={(q) => onChange({ q })}
        fields={apiFields(facets)}
        suggest={suggest}
        recentKey="apis"
        freeTextLabel="Endpoint"
        error={error}
        shortcuts={[
          { label: "GET", term: "method:GET" },
          { label: "POST", term: "method:POST" },
          { label: "写操作", term: "method:[POST,PUT,PATCH,DELETE]" },
        ]}
      />
      <Select
        value={filters.sort}
        onValueChange={(sort) => onChange({ sort: sort as APIFilters["sort"] })}
      >
        <SelectTrigger aria-label="API 排序" className="api-sort-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {apiSorts.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {apiSortLabels[sort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function apiFields(facets?: Facets): SearchQueryField[] {
  const facetOptions = (source?: { value: string; requests: number }[]) =>
    (source ?? [])
      .filter((option) => option.value)
      .map((option) => ({
        value: option.value,
        label: option.value,
        count: option.requests,
        countLabel: "个请求",
      }));
  const observedMethods = new Set(facets?.methods.map((facet) => facet.value));
  return [
    {
      key: "endpoint",
      type: "text",
      label: "Endpoint",
      hint: "标准化后的接口地址，*pay* 表示包含",
      aliases: ["url", "接口"],
      icon: LinkIcon,
    },
    {
      key: "method",
      type: "enum",
      label: "HTTP 方法",
      hint: "GET、POST、PUT、PATCH、DELETE 等",
      icon: CodeXmlIcon,
      options: apiMethods
        .filter((method) => !facets || observedMethods.has(method))
        .map((method) => ({
          value: method,
          label: method,
          count: facets?.methods.find((facet) => facet.value === method)?.requests,
          countLabel: "个请求",
        })),
    },
    {
      key: "release",
      type: "text",
      label: "版本",
      hint: "按 Release 定位接口回归",
      icon: PackageIcon,
      options: facetOptions(facets?.releases),
    },
    {
      key: "route",
      type: "text",
      label: "页面 Route",
      hint: "发起请求的页面",
      icon: RouteIcon,
      options: facetOptions(facets?.routes),
    },
  ];
}
