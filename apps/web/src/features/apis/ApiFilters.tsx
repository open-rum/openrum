import { ArrowDownWideNarrowIcon, CodeXmlIcon, PackageIcon, RouteIcon } from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "@/components/filters/FilterSearchComposer";
import {
  apiMethods,
  apiSortLabels,
  apiSorts,
  type APIFilters,
  type APIsResponse,
} from "@/lib/api/apis";

type Facets = APIsResponse["facets"];

export function ApiFilterBar({
  filters,
  facets,
  onChange,
}: {
  filters: APIFilters;
  facets?: Facets;
  onChange: (patch: Partial<APIFilters>) => void;
}) {
  return (
    <FilterSearchComposer
      ariaLabel="搜索 API 或添加筛选条件"
      placeholder="搜索 endpoint 或添加筛选条件…"
      fields={apiFields(facets)}
      tokens={apiTokens(filters)}
      shortcuts={[
        { label: "GET", onSelect: () => addMethod("GET", filters, onChange) },
        { label: "POST", onSelect: () => addMethod("POST", filters, onChange) },
        { label: "失败率排序", onSelect: () => onChange({ sort: "failureRate" }) },
      ]}
      onSearch={(search) => onChange({ search })}
      onSelect={(key, value) => {
        const selected = String(value);
        if (key === "method") addMethod(selected, filters, onChange);
        if (key === "release") onChange({ release: selected });
        if (key === "route") onChange({ route: selected });
        if (key === "sort") onChange({ sort: selected as APIFilters["sort"] });
      }}
      onRemove={(key) => {
        if (key === "search") onChange({ search: undefined });
        if (key === "release") onChange({ release: undefined });
        if (key === "route") onChange({ route: undefined });
        if (key === "sort") onChange({ sort: "requests" });
        if (key.startsWith("method:"))
          onChange({ methods: filters.methods.filter((method) => method !== key.slice(7)) });
      }}
    />
  );
}

function apiFields(facets?: Facets): FilterSearchField[] {
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
      key: "method",
      label: "HTTP 方法",
      hint: "GET、POST、PUT、PATCH、DELETE 等",
      icon: CodeXmlIcon,
      allowCustom: false,
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
      label: "版本",
      hint: "按 Release 定位接口回归",
      icon: PackageIcon,
      options: facetOptions(facets?.releases),
    },
    {
      key: "route",
      label: "页面 Route",
      hint: "查看特定页面发起的请求",
      icon: RouteIcon,
      options: facetOptions(facets?.routes),
    },
    {
      key: "sort",
      label: "排序",
      hint: "按请求量、失败、延迟或影响排序",
      icon: ArrowDownWideNarrowIcon,
      allowCustom: false,
      options: apiSorts.map((sort) => ({ value: sort, label: apiSortLabels[sort] })),
    },
  ];
}

function apiTokens(filters: APIFilters): FilterSearchToken[] {
  const tokens: FilterSearchToken[] = [];
  if (filters.search) tokens.push({ key: "search", label: `Endpoint：${filters.search}` });
  for (const method of filters.methods)
    tokens.push({ key: `method:${method}`, label: `方法：${method}` });
  if (filters.release) tokens.push({ key: "release", label: `版本：${filters.release}` });
  if (filters.route) tokens.push({ key: "route", label: `Route：${filters.route}` });
  if (filters.sort !== "requests")
    tokens.push({ key: "sort", label: `排序：${apiSortLabels[filters.sort]}` });
  return tokens;
}

function addMethod(
  method: string,
  filters: APIFilters,
  onChange: (patch: Partial<APIFilters>) => void,
) {
  if (!filters.methods.includes(method)) onChange({ methods: [...filters.methods, method] });
}
