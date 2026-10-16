import { ArrowLeftIcon, ChevronRightIcon, SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

export type FilterSearchOption = {
  value: string | number;
  label: string;
  count?: number;
  countLabel?: string;
};

export type FilterSearchField = {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Technical names and common synonyms used only for field discovery. */
  aliases?: string[];
  options?: FilterSearchOption[];
  allowCustom?: boolean;
};

export type FilterSearchToken = {
  key: string;
  label: string;
  /**
   * The field this token's value belongs to. A token with one can be edited in place: clicking
   * it reopens that field, and choosing a value replaces the old one through `onSelect`. Leave it
   * off for tokens that stack (several methods, several log terms): a replace there would need a
   * remove and an add together, which two page patches cannot do safely.
   */
  fieldKey?: string;
  /** The current value, prefilled into the input when the token is edited. */
  value?: string;
};

export type FilterSearchShortcut = {
  label: string;
  onSelect: () => void;
};

export function FilterSearchComposer({
  ariaLabel,
  placeholder = "搜索或添加筛选条件…",
  fields,
  tokens,
  shortcuts = [],
  searchLabel,
  fieldTerms = true,
  syntaxHint,
  onSelect,
  onRemove,
  onClear,
  onSearch,
}: {
  ariaLabel: string;
  placeholder?: string;
  fields: FilterSearchField[];
  tokens: FilterSearchToken[];
  shortcuts?: FilterSearchShortcut[];
  /** What plain text searches on this page; it is named in the first suggestion. */
  searchLabel?: string;
  /**
   * Whether `field:value` typed as one term becomes a filter. A page whose own query language
   * already reads that form (logs, with its wildcards and quoting) turns this off.
   */
  fieldTerms?: boolean;
  /** Replaces the hint under the suggestions about typing conditions directly. */
  syntaxHint?: string;
  onSelect: (fieldKey: string, value: string | number) => void;
  onRemove: (tokenKey: string) => void;
  /** Clears every condition this input owns. Offered once there are two or more. */
  onClear?: () => void;
  onSearch?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string>();
  const [draft, setDraft] = useState("");
  // Which suggestion the arrow keys are on. Null means "not moved yet": with text typed the
  // first row is the default, but Enter then still submits the text the way it always did.
  const [cursor, setCursor] = useState<number | null>(null);
  // The token a first Backspace selected; a second one removes it.
  const [pendingKey, setPendingKey] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const previousTokens = useRef(tokens);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const active = fields.find((field) => field.key === activeKey);
  const normalizedDraft = draft.trim().toLocaleLowerCase();
  const visibleFields = fields
    .map((field, index) => ({ field, index, score: fieldMatchScore(field, normalizedDraft) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ field }) => field);
  const visibleOptions = (active?.options ?? []).filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalizedDraft),
  );
  const parsed = fieldTerms && !active ? parseFieldTerm(draft, fields) : undefined;
  const parsedValue = parsed ? resolveTermValue(parsed.field, parsed.value) : undefined;

  const rows: Row[] = [];
  if (active) {
    for (const option of visibleOptions) rows.push({ kind: "option", option });
  } else {
    if (parsed && parsedValue !== undefined)
      rows.push({ kind: "parsed", field: parsed.field, value: parsedValue, text: parsed.value });
    else if (!parsed && onSearch && draft.trim()) rows.push({ kind: "search" });
    for (const field of visibleFields) rows.push({ kind: "field", field });
  }
  const highlighted = cursor ?? (normalizedDraft && rows.length ? 0 : -1);
  const highlightedRow = highlighted >= 0 ? rows[highlighted] : undefined;
  const rowId = (index: number) => `${baseId}-row-${index}`;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  // Tells a screen reader what a click or a keystroke did to the conditions, which are otherwise
  // only visible as chips appearing and disappearing.
  useEffect(() => {
    const before = previousTokens.current;
    previousTokens.current = tokens;
    const signature = (token: FilterSearchToken) => `${token.key}\u0000${token.label}`;
    const known = new Set(before.map(signature));
    const current = new Set(tokens.map(signature));
    const added = tokens.filter((token) => !known.has(signature(token)));
    const removed = before.filter((token) => !current.has(signature(token)));
    if (added.length)
      setAnnouncement(`已添加筛选：${added.map((token) => token.label).join("、")}`);
    else if (removed.length)
      setAnnouncement(`已移除筛选：${removed.map((token) => token.label).join("、")}`);
  }, [tokens]);

  useEffect(() => {
    if (highlighted >= 0 && open)
      document.getElementById(rowId(highlighted))?.scrollIntoView?.({ block: "nearest" });
    // rowId only depends on baseId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, open]);

  const resetComposer = () => {
    setActiveKey(undefined);
    setDraft("");
    setCursor(null);
    inputRef.current?.focus();
  };
  const enterField = (field: FilterSearchField, value = "") => {
    setActiveKey(field.key);
    setDraft(value);
    setCursor(null);
    setOpen(true);
    inputRef.current?.focus();
  };
  const selectValue = (value: string | number) => {
    if (!active) return;
    onSelect(active.key, value);
    resetComposer();
  };
  const commitDraft = () => {
    const value = draft.trim();
    if (!value) {
      setOpen(false);
      return;
    }
    if (active) {
      if (active.allowCustom === false) {
        // A label or a value: `sort:users` and `sort:影响用户` mean the same choice.
        const resolved = resolveTermValue(active, unquote(value));
        if (resolved === undefined) return;
        onSelect(active.key, resolved);
      } else onSelect(active.key, unquote(value));
    } else if (parsed) {
      // A known field with a value it does not accept: keep what was typed so it can be fixed.
      if (parsedValue === undefined) return;
      onSelect(parsed.field.key, parsedValue);
    } else onSearch?.(value);
    resetComposer();
  };
  const activateRow = (row: Row) => {
    if (row.kind === "option") selectValue(row.option.value);
    else if (row.kind === "field") enterField(row.field);
    else commitDraft();
  };
  const removeToken = (token: FilterSearchToken) => {
    setPendingKey(undefined);
    onRemove(token.key);
  };
  const editToken = (token: FilterSearchToken) => {
    const field = fields.find((candidate) => candidate.key === token.fieldKey);
    if (field) enterField(field, token.value ?? "");
  };
  const moveCursor = (step: 1 | -1) => {
    if (!rows.length) return;
    setOpen(true);
    const from = highlighted;
    setCursor(
      from < 0 ? (step === 1 ? 0 : rows.length - 1) : (from + step + rows.length) % rows.length,
    );
  };
  const hint = active
    ? "选择建议值或输入自定义值"
    : (syntaxHint ??
      (fieldTerms ? `可直接输入 字段:值，例如 ${termExample(fields)}` : "输入可搜索条件"));
  const canSubmit = Boolean(draft.trim()) || Boolean(active);

  return (
    <div className="filter-search-composer">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <InputGroup
            // PopoverAnchor overwrites data-slot on this element, so the group is found by its own attribute.
            data-composer-anchor=""
            className="h-auto min-h-[var(--control-height)] flex-wrap rounded-[calc(var(--control-height)/2)] bg-background"
          >
            <InputGroupAddon className="flex-wrap justify-start gap-1.5">
              <SearchIcon aria-hidden="true" />
              {tokens.map((token) => (
                <Badge
                  key={token.key}
                  variant="secondary"
                  data-pending={pendingKey === token.key || undefined}
                  className="h-7 gap-1 pl-2.5 pr-0.5"
                >
                  {token.fieldKey ? (
                    <button
                      type="button"
                      className="filter-search-composer__token"
                      aria-label={`编辑筛选：${token.label}`}
                      onClick={() => editToken(token)}
                    >
                      {token.label}
                    </button>
                  ) : (
                    token.label
                  )}
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`移除筛选：${token.label}`}
                    onClick={() => removeToken(token)}
                  >
                    <XIcon />
                  </InputGroupButton>
                </Badge>
              ))}
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              className="min-w-44 flex-[1_1_12rem]"
              role="combobox"
              aria-label={ariaLabel}
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && highlightedRow ? rowId(highlighted) : undefined}
              placeholder={active ? `输入${active.label}的值…` : placeholder}
              value={draft}
              onFocus={() => setOpen(true)}
              onBlur={() => setPendingKey(undefined)}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                const next = event.target.value;
                setPendingKey(undefined);
                setCursor(null);
                // `name:` with a known name opens that field, so the rest is typed as its value.
                const opening = fieldTerms && !active ? /^([^\s:"]+):$/.exec(next) : null;
                const named = opening ? findField(fields, opening[1]) : undefined;
                if (named) {
                  enterField(named);
                  return;
                }
                setDraft(next);
              }}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !draft && tokens.length) {
                  const last = tokens.at(-1)!;
                  if (pendingKey === last.key) {
                    setPendingKey(undefined);
                    onRemove(last.key);
                  } else {
                    setPendingKey(last.key);
                    setAnnouncement(`再按一次退格删除：${last.label}`);
                  }
                  return;
                }
                if (!["Backspace", "Shift", "Control", "Alt", "Meta"].includes(event.key))
                  setPendingKey(undefined);
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveCursor(event.key === "ArrowDown" ? 1 : -1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (cursor !== null && highlightedRow) activateRow(highlightedRow);
                  else commitDraft();
                } else if (event.key === "Tab") {
                  // Completes to a field: the highlighted one, or the best match for the text when
                  // the highlighted row is the plain-text search above them.
                  const target =
                    highlightedRow?.kind === "field"
                      ? highlightedRow
                      : highlightedRow?.kind === "search"
                        ? rows.find((row) => row.kind === "field")
                        : undefined;
                  if (open && !active && target?.kind === "field") {
                    event.preventDefault();
                    enterField(target.field);
                  }
                } else if (event.key === "Escape") {
                  if (open) setOpen(false);
                  else if (draft || active) {
                    setDraft("");
                    setActiveKey(undefined);
                  }
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              {onClear && tokens.length >= 2 ? (
                <InputGroupButton
                  aria-label="清除全部筛选"
                  onClick={() => {
                    setPendingKey(undefined);
                    onClear();
                    inputRef.current?.focus();
                  }}
                >
                  清除全部
                </InputGroupButton>
              ) : null}
              <kbd>/</kbd>
            </InputGroupAddon>
          </InputGroup>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (event.target === inputRef.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            const anchor = inputRef.current?.closest("[data-composer-anchor]");
            if (target instanceof Node && anchor?.contains(target)) event.preventDefault();
          }}
        >
          {active ? (
            <>
              <PopoverHeader className="flex-row items-center gap-3 p-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="返回筛选条件"
                  onClick={resetComposer}
                >
                  <ArrowLeftIcon />
                </Button>
                <div>
                  <PopoverTitle>{active.label}</PopoverTitle>
                  <PopoverDescription>
                    {active.allowCustom === false
                      ? "选择一个建议值。"
                      : "选择一个建议值，或在搜索框输入自定义值。"}
                  </PopoverDescription>
                </div>
              </PopoverHeader>
              <Separator />
            </>
          ) : (
            <>
              <PopoverHeader className="p-3">
                <PopoverTitle>添加筛选条件</PopoverTitle>
                <PopoverDescription>条件会显示在搜索框内；可继续组合多个条件。</PopoverDescription>
              </PopoverHeader>
              {shortcuts.length ? (
                <div className="flex flex-wrap gap-2 px-3 pb-3">
                  {shortcuts.map((shortcut) => (
                    <Button
                      key={shortcut.label}
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={shortcut.onSelect}
                    >
                      {shortcut.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Separator />
            </>
          )}
          <div
            role="listbox"
            id={listId}
            aria-label={active ? `${active.label}的建议值` : "筛选建议"}
            className="max-h-80 overflow-y-auto p-2"
          >
            <div role="presentation" className="grid gap-1 sm:grid-cols-2">
              {rows.map((row, index) => (
                <SuggestionRow
                  key={rowKey(row)}
                  id={rowId(index)}
                  row={row}
                  draft={draft.trim()}
                  searchLabel={searchLabel}
                  highlighted={index === highlighted}
                  onActivate={() => activateRow(row)}
                />
              ))}
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {active
                ? active.allowCustom === false
                  ? "没有匹配的建议值。"
                  : "没有匹配的建议值，可直接按 Enter 使用当前输入。"
                : onSearch
                  ? "按 Enter 将当前内容作为关键词搜索。"
                  : "没有匹配的筛选条件。"}
            </p>
          ) : null}
          <Separator />
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <span>{hint}</span>
            <span>↑↓ 选择 · Enter 添加 · Esc 关闭</span>
          </div>
        </PopoverContent>
      </Popover>
      {canSubmit ? (
        <Button type="button" onClick={commitDraft}>
          查询
        </Button>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

type Row =
  | { kind: "option"; option: FilterSearchOption }
  | { kind: "field"; field: FilterSearchField }
  | { kind: "parsed"; field: FilterSearchField; value: string | number; text: string }
  | { kind: "search" };

function rowKey(row: Row) {
  if (row.kind === "option") return `option:${row.option.value}`;
  if (row.kind === "field") return `field:${row.field.key}`;
  return row.kind;
}

function SuggestionRow({
  id,
  row,
  draft,
  searchLabel,
  highlighted,
  onActivate,
}: {
  id: string;
  row: Row;
  draft: string;
  searchLabel?: string;
  highlighted: boolean;
  onActivate: () => void;
}) {
  const base =
    "h-auto justify-start rounded-xl text-left whitespace-normal data-[highlighted=true]:bg-accent";
  const common = {
    id,
    type: "button" as const,
    role: "option" as const,
    tabIndex: -1,
    variant: "ghost" as const,
    "aria-selected": highlighted,
    "data-highlighted": highlighted,
    onClick: onActivate,
    // Keep focus in the input: a click on a suggestion must not move it into the popover.
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
  };
  if (row.kind === "option") {
    const { option } = row;
    return (
      <Button {...common} className={`${base} min-h-11 px-3 py-2`}>
        <span className="min-w-0 flex-1">
          <strong className="block font-medium">{option.label}</strong>
          {option.count !== undefined ? (
            <small className="text-muted-foreground">
              {option.count.toLocaleString()} {option.countLabel ?? "条"}
            </small>
          ) : null}
        </span>
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    );
  }
  if (row.kind === "field") {
    const Icon = row.field.icon;
    return (
      <Button {...common} className={`${base} min-h-14 gap-3 px-3 py-2`}>
        <Icon aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block font-medium">{row.field.label}</strong>
          <small className="text-muted-foreground">{row.field.hint}</small>
        </span>
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    );
  }
  if (row.kind === "parsed") {
    const Icon = row.field.icon;
    return (
      <Button {...common} className={`${base} min-h-14 gap-3 px-3 py-2 sm:col-span-2`}>
        <Icon aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block font-medium">
            添加筛选：{row.field.label}：{row.text}
          </strong>
          <small className="text-muted-foreground">按字段名和值识别，按 Enter 添加</small>
        </span>
      </Button>
    );
  }
  return (
    <Button {...common} className={`${base} min-h-14 gap-3 px-3 py-2 sm:col-span-2`}>
      <SearchIcon aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong className="block font-medium">
          {searchLabel ? `在「${searchLabel}」中搜索` : "搜索"} “{draft}”
        </strong>
        <small className="text-muted-foreground">按 Enter 搜索</small>
      </span>
    </Button>
  );
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function fieldMatchScore(field: FilterSearchField, query: string) {
  if (!query) return 0;
  const terms = [field.key, field.label, field.hint, ...(field.aliases ?? [])].map((term) =>
    term.toLocaleLowerCase(),
  );
  if (terms.some((term) => term === query)) return 0;
  if (terms.some((term) => term.startsWith(query))) return 1;
  if (terms.some((term) => term.split(/[\s._/-]+/).some((token) => token.startsWith(query))))
    return 2;
  if (terms.some((term) => term.includes(query))) return 3;
  return Number.POSITIVE_INFINITY;
}

/** Drops one pair of quotes around a typed value, as in `route:"/a b"`. */
function unquote(value: string) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\"/g, '"')
    : value;
}

/** Finds a field by what a person would type for it: its key, a synonym, or its label. */
function findField(fields: FilterSearchField[], name: string) {
  const wanted = name.toLocaleLowerCase();
  return fields.find((field) =>
    [field.key, field.label, ...(field.aliases ?? [])].some(
      (term) => term.toLocaleLowerCase() === wanted,
    ),
  );
}

/**
 * Reads the whole draft as one `name:value` condition. The value is either a single word or a
 * quoted phrase; anything with more in it (several conditions, a sentence after the colon) is
 * left as text, because guessing which part is the filter would be worse than not guessing.
 */
function parseFieldTerm(draft: string, fields: FilterSearchField[]) {
  const text = draft.trim();
  const match = /^([^\s:"]+):(\S.*)$/.exec(text);
  if (!match) return undefined;
  const field = findField(fields, match[1]);
  if (!field) return undefined;
  const rest = match[2];
  let value = rest;
  if (rest.startsWith('"')) {
    if (rest.length < 2 || !rest.endsWith('"')) return undefined;
    value = rest.slice(1, -1).replace(/\\"/g, '"');
  } else if (/\s/.test(rest)) return undefined;
  return value ? { field, value } : undefined;
}

/**
 * The value a parsed term would be filtered by. A field that only takes its own suggestions
 * accepts a label or a value that matches one of them, and nothing else.
 */
function resolveTermValue(field: FilterSearchField, text: string): string | number | undefined {
  if (field.allowCustom !== false) return text;
  const wanted = text.toLocaleLowerCase();
  return field.options?.find(
    (option) =>
      option.label.toLocaleLowerCase() === wanted ||
      String(option.value).toLocaleLowerCase() === wanted,
  )?.value;
}

function termExample(fields: FilterSearchField[]) {
  // A field that takes any value makes the clearest example; a choice-only one is the fallback.
  const field = fields.find((candidate) => candidate.allowCustom !== false) ?? fields[0];
  return `${field?.key ?? "release"}:…`;
}
