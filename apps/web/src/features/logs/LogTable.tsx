import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LogEntry } from "@/lib/api/logs";
import { LogLevelBadge } from "./LogDetails";
import { LogFieldActions, type LogFieldCallbacks } from "./LogFieldActions";
import { LogMessage } from "./LogMessage";
import { logTime } from "./logNavigation";
import { logColumnLabel, logColumnValue, validLogAttribute } from "./logPresentation";

type TableProps = LogFieldCallbacks & {
  items: LogEntry[];
  query: string;
  selectedId: string;
  anchorId?: string;
  locationKey: string;
  onOpen: (entry: LogEntry) => void;
  onRemoveColumn: (key: string) => void;
};

export function LogTable(props: TableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const located = useRef("");
  useEffect(() => {
    if (!props.anchorId || located.current === props.locationKey) return;
    const container = scrollRef.current;
    const anchor = container?.querySelector<HTMLElement>("[data-anchor='true']");
    if (!container || !anchor) return;
    container.scrollTop +=
      anchor.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      container.clientHeight / 2 +
      anchor.clientHeight / 2;
    located.current = props.locationKey;
  }, [props.anchorId, props.locationKey, props.items]);
  return (
    <div ref={scrollRef} className="max-h-[min(65vh,720px)] overflow-auto">
      <table
        aria-label="日志列表"
        className="table table-sm table-pin-rows logs-table w-full table-fixed"
        style={{ minWidth: 520 + props.columns.length * 176 }}
      >
        <thead>
          <tr>
            <th className="w-10 bg-base-100">
              <span className="sr-only">展开日志</span>
            </th>
            <th className="w-36 bg-base-100">时间</th>
            <th className="w-20 bg-base-100">级别</th>
            <th className="bg-base-100">消息</th>
            {props.columns.map((key) => (
              <th key={key} className="group/column w-44 bg-base-100">
                <div className="flex items-center gap-1">
                  <span className="truncate" title={key === "source" ? logColumnLabel(key) : key}>
                    {logColumnLabel(key)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square ml-auto shrink-0 opacity-0 transition-opacity group-hover/column:opacity-100 group-focus-within/column:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                    title={`移除 ${logColumnLabel(key)} 列`}
                    aria-label={`移除 ${logColumnLabel(key)} 列`}
                    onClick={() => props.onRemoveColumn(key)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <LogRow key={item.eventId} {...props} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogRow({
  item,
  query,
  selectedId,
  anchorId,
  columns,
  onOpen,
  onFilter,
  onColumn,
}: TableProps & { item: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const anchor = item.eventId === anchorId;
  const common = ["logger", "route", "user.id", "trace_id"].filter((key) =>
    logColumnValue(item, key),
  );
  const attributes = Object.entries(item.attributes);
  const callbacks = { onFilter, onColumn, columns };
  return (
    <Fragment>
      <tr
        data-anchor={anchor}
        className={`logs-data-row cursor-pointer hover:bg-base-200 ${anchor ? "logs-anchor bg-primary/10" : item.eventId === selectedId || expanded ? "bg-base-200" : ""}`}
        onClick={() => onOpen(item)}
      >
        <td className="logs-expand-cell">
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            aria-label={`${expanded ? "收起" : "展开"}日志 ${logTime(item.timestamp, true)}`}
            aria-expanded={expanded}
            aria-controls={`log-inline-${item.eventId}`}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
          </button>
        </td>
        <td className="logs-time-cell font-mono text-[11px] whitespace-nowrap text-base-content/70">
          <time dateTime={item.timestamp} title={logTime(item.timestamp, true)}>
            {logTime(item.timestamp)}
          </time>
          {anchor ? (
            <span className="mt-1 block font-sans text-xs font-semibold text-base-content">
              原日志
            </span>
          ) : null}
        </td>
        <td className="logs-level-cell">
          <LogLevelBadge level={item.level} />
        </td>
        <td className="logs-message-cell">
          <button
            type="button"
            className={`logs-message-button ${expanded ? "logs-message-expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}
          >
            <LogMessage message={item.message} query={query} />
          </button>
        </td>
        {columns.map((key) => (
          <td
            key={key}
            className={`logs-optional-cell ${key === "source" ? "logs-source-cell" : ""}`}
          >
            {key === "source" ? (
              <>
                <div className="truncate text-xs" title={item.logger}>
                  {item.logger || "应用"}
                </div>
                <div className="truncate text-[11px] text-base-content/70" title={item.route}>
                  {item.route || "—"}
                </div>
              </>
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <span
                  className="max-w-32 truncate text-[11px] text-base-content/70 sm:hidden"
                  title={logColumnLabel(key)}
                >
                  {logColumnLabel(key)}
                </span>
                <span className="truncate font-mono text-xs" title={logColumnValue(item, key)}>
                  {logColumnValue(item, key) || "—"}
                </span>
                <div className="ml-auto shrink-0">
                  <LogFieldActions field={key} value={logColumnValue(item, key)} {...callbacks} />
                </div>
              </div>
            )}
          </td>
        ))}
      </tr>
      {expanded ? (
        <tr className="logs-inline-row bg-base-200/50">
          <td colSpan={4 + columns.length}>
            <div
              id={`log-inline-${item.eventId}`}
              className="grid min-w-0 gap-3 p-2 sm:pl-10"
              aria-label="日志行详情"
            >
              <dl className="grid min-w-0 gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                {common.map((key) => (
                  <InlineField
                    key={key}
                    field={key}
                    label={logColumnLabel(key)}
                    value={logColumnValue(item, key)}
                    {...callbacks}
                  />
                ))}
                {attributes.slice(0, 6).map(([key, value]) => (
                  <InlineField
                    key={key}
                    field={`attributes.${key}`}
                    label={key}
                    value={value}
                    filterable={validLogAttribute(key)}
                    {...callbacks}
                  />
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => onOpen(item)}>
                  查看完整详情
                </Button>
                {attributes.length > 6 ? (
                  <span className="text-xs text-base-content/70">
                    另有 {attributes.length - 6} 项属性
                  </span>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function InlineField({
  field,
  label,
  value,
  filterable,
  ...callbacks
}: LogFieldCallbacks & { field: string; label: string; value: string; filterable?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-base-300 py-1">
      <dt className="break-all text-[11px] text-base-content/70">{label}</dt>
      <dd className="col-start-1 break-all font-mono text-xs">{value || "—"}</dd>
      <div className="col-start-2 row-start-1 row-span-2">
        <LogFieldActions
          field={field}
          label={label}
          value={value}
          filterable={filterable}
          {...callbacks}
        />
      </div>
    </div>
  );
}
