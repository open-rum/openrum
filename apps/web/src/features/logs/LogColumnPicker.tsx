import { useState } from "react";
import { Columns3Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LogEntry } from "@/lib/api/logs";
import { defaultLogColumns, logColumnLabel, logColumns, validLogColumn } from "./logPresentation";

export function LogColumnPicker({
  columns,
  items,
  onChange,
}: {
  columns: string[];
  items: LogEntry[];
  onChange: (columns: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const available = [
    ...new Set([
      ...logColumns.map((column) => column.key),
      ...columns,
      ...items.flatMap((item) => Object.keys(item.attributes).map((key) => `attributes.${key}`)),
    ]),
  ].filter(validLogColumn);
  const visible = available.filter((key) =>
    `${key} ${logColumnLabel(key)}`.toLowerCase().includes(search.toLowerCase()),
  );
  const custom = search.trim().startsWith("attributes.")
    ? search.trim()
    : `attributes.${search.trim()}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="显示列" title="显示列">
          <Columns3Icon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="max-h-(--radix-popover-content-available-height) w-[min(340px,calc(100vw-2rem))] gap-2 overflow-hidden p-3"
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">显示列</h3>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onChange(defaultLogColumns)}
          >
            恢复默认
          </button>
        </div>
        <input
          className="input input-sm w-full shrink-0"
          aria-label="查找或添加属性列"
          placeholder="查找字段，或输入属性名"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <p className="shrink-0 text-[11px] text-base-content/70">
          时间、级别和消息固定显示。选择保存在此浏览器。
        </p>
        <div className="min-h-0 max-h-64 overflow-y-auto">
          {visible.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded-field px-2 py-2 text-xs hover:bg-base-200"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={columns.includes(key)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...columns, key]
                      : columns.filter((column) => column !== key),
                  )
                }
              />
              <span className="min-w-0 break-all">{logColumnLabel(key)}</span>
              {key.startsWith("attributes.") ? (
                <span className="ml-auto shrink-0 text-[11px] text-base-content/70">属性</span>
              ) : null}
            </label>
          ))}
          {!visible.length ? (
            <p className="p-2 text-xs text-base-content/70">没有匹配的已知字段</p>
          ) : null}
        </div>
        {search.trim() && validLogColumn(custom) && !available.includes(custom) ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2 h-auto w-full py-2 text-left"
            onClick={() => {
              onChange([...columns, custom]);
              setSearch("");
            }}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="break-all">添加 {custom}</span>
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
