import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  apiMethods,
  apiSortLabels,
  apiSorts,
  minimumAPISamples,
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
  // The draft follows the applied search whenever it changes elsewhere, such as
  // browser navigation, without an effect that would cascade a second render.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");
  const [appliedSearch, setAppliedSearch] = useState(filters.search);
  if (filters.search !== appliedSearch) {
    setAppliedSearch(filters.search);
    setSearchDraft(filters.search ?? "");
  }
  const filtered =
    Boolean(filters.search ?? filters.release ?? filters.route) || filters.methods.length > 0;
  return (
    <form
      className="apis-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ search: searchDraft.trim() || undefined });
      }}
    >
      <div className="apis-search">
        <SearchIcon aria-hidden="true" />
        <Input
          aria-label="搜索 endpoint"
          placeholder="搜索归一化 endpoint，例如 /orders"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
      </div>
      <MethodFilter
        selected={filters.methods}
        available={facets?.methods}
        onChange={(methods) => onChange({ methods })}
      />
      <FacetSelect
        label="全部版本"
        value={filters.release}
        options={facets?.releases}
        onChange={(release) => onChange({ release })}
      />
      <FacetSelect
        label="全部 Route"
        value={filters.route}
        options={facets?.routes}
        onChange={(route) => onChange({ route })}
      />
      <Select
        value={filters.sort}
        onValueChange={(value) => onChange({ sort: value as APIFilters["sort"] })}
      >
        <SelectTrigger aria-label="API 排序">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {apiSorts.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {apiSortLabels[sort]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button type="submit">查询</Button>
      {filtered ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSearchDraft("");
            onChange({ search: undefined, release: undefined, route: undefined, methods: [] });
          }}
        >
          清除筛选
        </Button>
      ) : null}
      <span>
        URL 已归一化
        {filters.sort === "p95" || filters.sort === "failureRate"
          ? ` · 不足 ${minimumAPISamples} 次请求的 endpoint 排在末尾`
          : ""}
      </span>
    </form>
  );
}

function MethodFilter({
  selected,
  available,
  onChange,
}: {
  selected: string[];
  available?: Facets["methods"];
  onChange: (methods: string[]) => void;
}) {
  const observed = new Set(available?.map((facet) => facet.value));
  const options = apiMethods.filter(
    (method) => !available || observed.has(method) || selected.includes(method),
  );
  if (!options.length) return null;
  return (
    <div className="apis-methods" role="group" aria-label="HTTP 方法筛选">
      {options.map((method) => {
        const active = selected.includes(method);
        return (
          <Button
            key={method}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={() =>
              onChange(
                active ? selected.filter((value) => value !== method) : [...selected, method],
              )
            }
          >
            {method}
          </Button>
        );
      })}
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options = [],
  onChange,
}: {
  label: string;
  value?: string;
  options?: { value: string; requests: number }[];
  onChange: (value?: string) => void;
}) {
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(next) => onChange(next === "all" ? undefined : next)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{label}</SelectItem>
          {options
            .filter((option) => option.value)
            .map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.value} · {option.requests.toLocaleString()}
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
