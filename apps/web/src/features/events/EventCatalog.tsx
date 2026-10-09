import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eventLabel } from "@/features/analytics/labels";
import type { BehaviorKind } from "@/lib/api/analytics";
import { kindLabel, sortCatalog, type CatalogEntry, type CatalogSortKey } from "./catalog";

export function EventCatalog({
  catalog,
  selectedKind,
  selectedName,
  onSelect,
  onClear,
}: {
  catalog: CatalogEntry[];
  selectedKind?: BehaviorKind;
  selectedName?: string;
  onSelect: (kind: BehaviorKind, name: string) => void;
  onClear: () => void;
}) {
  // Searching and narrowing by type live in the page's shared filter search, so the list
  // itself only re-sorts.
  const [sort, setSort] = useState<CatalogSortKey>("events");
  const rows = useMemo(() => sortCatalog(catalog, sort), [catalog, sort]);
  const peak = Math.max(1, ...catalog.map((entry) => entry.metric.events));
  const hasSelection = Boolean(selectedKind || selectedName);

  return (
    <section className="behavior-panel event-catalog" aria-labelledby="event-catalog-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="event-catalog-title">事件目录</h2>
          <p>{catalog.length} 个活跃事件，点击表头排序</p>
        </div>
        {hasSelection ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            清除选择
          </Button>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="事件" sortKey="name" active={sort} onSort={setSort} />
            <SortHead label="次数" sortKey="events" active={sort} onSort={setSort} />
            <SortHead label="用户" sortKey="users" active={sort} onSort={setSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((event) => {
            const selected = event.kind === selectedKind && event.name === selectedName;
            const choose = () => onSelect(event.kind as BehaviorKind, event.name);
            return (
              <TableRow
                key={`${event.kind}:${event.name}`}
                tabIndex={0}
                aria-selected={selected}
                data-state={selected ? "selected" : undefined}
                className="cursor-pointer"
                onClick={choose}
                onKeyDown={(key) => {
                  if (key.key === "Enter" || key.key === " ") {
                    key.preventDefault();
                    choose();
                  }
                }}
              >
                <TableCell>
                  <strong>{eventLabel(event.kind, event.name)}</strong>
                  <small>{kindLabel(event.kind)}</small>
                </TableCell>
                <TableCell>
                  {event.metric.events.toLocaleString()}
                  <span className="event-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, (event.metric.events / peak) * 100)}%` }} />
                  </span>
                </TableCell>
                <TableCell>{event.metric.uniqueUsers.toLocaleString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function SortHead({
  label,
  sortKey,
  active,
  onSort,
}: {
  label: string;
  sortKey: CatalogSortKey;
  active: CatalogSortKey;
  onSort: (key: CatalogSortKey) => void;
}) {
  const current = active === sortKey;
  return (
    <TableHead aria-sort={current ? (sortKey === "name" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="event-sort"
        data-active={current || undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {current ? (
          sortKey === "name" ? (
            <ArrowUpIcon aria-hidden="true" />
          ) : (
            <ArrowDownIcon aria-hidden="true" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}
