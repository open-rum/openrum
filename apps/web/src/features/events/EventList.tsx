import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent } from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";
import type { BehaviorKind } from "@/lib/api/analytics";
import { kindLabel, type CatalogEntry } from "./catalog";
import {
  defaultColumns,
  defaultSort,
  listColumns,
  nextSort,
  perUser,
  readColumns,
  sortEntries,
  writeColumns,
  type ColumnId,
  type SortState,
} from "./listColumns";

/**
 * One row per event the Project reports. Which columns show is the reader's choice and is
 * remembered in this browser; a row opens that event's drawer rather than changing the
 * page's filters, so looking at an event never rewrites the charts above.
 */
export function EventList({
  catalog,
  total,
  selectedKind,
  selectedName,
  onOpen,
}: {
  catalog: CatalogEntry[];
  /** Events across the whole range, the denominator for the share column. */
  total: number;
  selectedKind?: BehaviorKind;
  selectedName?: string;
  onOpen: (kind: BehaviorKind, name: string) => void;
}) {
  const [columns, setColumns] = useState<ColumnId[]>(readColumns);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const rows = useMemo(() => sortEntries(catalog, sort), [catalog, sort]);
  const visible = listColumns.filter((column) => columns.includes(column.id));
  const peak = Math.max(1, ...catalog.map((entry) => entry.metric.events));

  function choose(next: ColumnId[]) {
    const ordered = listColumns.map((column) => column.id).filter((id) => next.includes(id));
    setColumns(ordered);
    writeColumns(ordered);
  }

  return (
    <section className="behavior-panel event-list" aria-labelledby="event-list-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="event-list-title">事件列表</h2>
          <p>{catalog.length} 个活跃事件，点击一行查看详情，点击表头排序</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3Icon data-icon="inline-start" />列
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>显示的列</DropdownMenuLabel>
            {listColumns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={columns.includes(column.id)}
                disabled={column.fixed}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  choose(
                    checked ? [...columns, column.id] : columns.filter((id) => id !== column.id),
                  )
                }
              >
                <span className="event-list__column-option">
                  {column.label}
                  {column.hint ? <small>{column.hint}</small> : null}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={false}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => choose(defaultColumns)}
            >
              恢复默认
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {visible.map((column) => {
              const active = sort.key === column.id;
              return (
                <TableHead
                  key={column.id}
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={column.id === "name" ? "event-list__name" : undefined}
                >
                  <button
                    type="button"
                    className="event-sort"
                    data-active={active || undefined}
                    onClick={() => setSort(nextSort(sort, column.id))}
                  >
                    {column.label}
                    {active ? (
                      sort.direction === "asc" ? (
                        <ArrowUpIcon aria-hidden="true" />
                      ) : (
                        <ArrowDownIcon aria-hidden="true" />
                      )
                    ) : null}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => {
            const selected = entry.kind === selectedKind && entry.name === selectedName;
            const open = () => onOpen(entry.kind as BehaviorKind, entry.name);
            return (
              <TableRow
                key={`${entry.kind}:${entry.name}`}
                tabIndex={0}
                aria-selected={selected}
                data-state={selected ? "selected" : undefined}
                className="cursor-pointer"
                onClick={open}
                onKeyDown={(key) => {
                  if (key.target !== key.currentTarget) return;
                  if (key.key === "Enter" || key.key === " ") {
                    key.preventDefault();
                    open();
                  }
                }}
              >
                {visible.map((column) => (
                  <TableCell key={column.id}>
                    <Cell
                      id={column.id}
                      entry={entry}
                      total={total}
                      peak={peak}
                      showKind={!columns.includes("kind")}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function Cell({
  id,
  entry,
  total,
  peak,
  showKind,
}: {
  id: ColumnId;
  entry: CatalogEntry;
  total: number;
  peak: number;
  /** The type is written under the name only while it has no column of its own. */
  showKind: boolean;
}) {
  switch (id) {
    case "name": {
      const label = eventLabel(entry.kind, entry.name);
      // Built-in kinds are named after their only event, so repeating it says nothing.
      const kind = kindLabel(entry.kind);
      return (
        <>
          <strong>{label}</strong>
          {showKind && kind !== label ? <small>{kind}</small> : null}
        </>
      );
    }
    case "kind":
      return <>{kindLabel(entry.kind)}</>;
    case "events":
      return (
        <>
          {entry.metric.events.toLocaleString()}
          <span className="event-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (entry.metric.events / peak) * 100)}%` }} />
          </span>
        </>
      );
    case "share":
      return <>{formatPercent(entry.metric.events, total)}</>;
    case "users":
      return <>{entry.metric.uniqueUsers.toLocaleString()}</>;
    case "sessions":
      return <>{entry.metric.uniqueSessions.toLocaleString()}</>;
    case "perUser":
      return <>{perUser(entry).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</>;
    case "estimated":
      return <>{Math.round(entry.metric.estimated).toLocaleString()}</>;
  }
}
