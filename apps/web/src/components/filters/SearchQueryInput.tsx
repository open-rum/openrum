import { HistoryIcon, SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  caretContext,
  highlight,
  operatorShapes,
  replaceSpan,
  shapeOf,
  writeShape,
  type CaretContext,
  type OperatorShape,
} from "@/lib/search/query";
import {
  describeTerm,
  readRecentTerms,
  rememberTerm,
  splitQuery,
  type SearchFieldType,
} from "@/lib/search/terms";

export type SearchQueryOption = {
  value: string | number;
  label: string;
  count?: number;
  countLabel?: string;
};

/** One field a page lets people search. */
export type SearchQueryField = {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  type: SearchFieldType;
  /** The field's name in the query, when it differs from `key`. */
  term?: string;
  /** Technical names and synonyms that also find the field. */
  aliases?: string[];
  /** Values to suggest without asking the server, such as log levels. */
  options?: SearchQueryOption[];
  /** Only field:value applies, as with is:unresolved; the operator choice is hidden. */
  equalsOnly?: boolean;
};

type FilterSearchField = SearchQueryField;
type FilterSearchOption = SearchQueryOption;

export type SearchQueryShortcut = { label: string; term: string };

export type SearchQueryError = {
  message: string;
  /** Where in the query the refused condition starts, as the server reported it. */
  position?: number;
  term?: string;
};

/**
 * The shared search box. The query is plain text, such as `user.id:"c-1" AND !browser:Chrome`,
 * so it can be copied, pasted and edited like code; colours show its parts, and suggestions
 * follow the caret: field names while a name is typed, operators and values after the colon.
 * Choosing a suggestion writes into the text; nothing is hidden in tokens.
 */
export function SearchQueryInput({
  ariaLabel,
  placeholder = '输入查询，例如 user.id:"customer-1" AND !browser:Chrome',
  value,
  onSubmit,
  fields,
  attributes = false,
  suggest,
  recentKey,
  shortcuts = [],
  freeTextLabel,
  error,
}: {
  ariaLabel: string;
  placeholder?: string;
  /** The query in effect (the page's `q`). */
  value: string;
  onSubmit: (query: string | undefined) => void;
  fields: FilterSearchField[];
  /** Lets attributes.<name> be written even without a field for that name. */
  attributes?: boolean;
  suggest?: (
    field: FilterSearchField,
    contains: string,
    signal: AbortSignal,
  ) => Promise<FilterSearchOption[]>;
  /** Remembers submitted queries in this browser under this name. */
  recentKey?: string;
  /** Common conditions offered as one-click additions when the box is empty. */
  shortcuts?: SearchQueryShortcut[];
  /** What a word with no field searches; undefined when the page has no text search. */
  freeTextLabel?: string;
  error?: SearchQueryError;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    // The page's query changed from outside (a link, back/forward, a shortcut): show it.
    setSynced(value);
    setDraft(value);
  }
  const [caret, setCaret] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pendingShape, setPendingShape] = useState<{ field: string; shape: OperatorShape }>();
  const [remote, setRemote] = useState<{ key: string; options: FilterSearchOption[] }>();
  const [recent, setRecent] = useState<string[]>(() =>
    recentKey ? readRecentTerms(recentKey) : [],
  );
  const [scrollLeft, setScrollLeft] = useState(0);
  // Right after a value is added to a list, every other value is offered again.
  const [listPicked, setListPicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextCaret = useRef<number | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const context = caretContext(draft, caret);
  const fieldFor = (name: string) => findField(fields, name, attributes);
  const activeField = context.kind === "value" ? fieldFor(context.field) : undefined;
  const shapes = activeField?.equalsOnly
    ? []
    : activeField?.type
      ? operatorShapes(activeField.type)
      : [];
  const chosenShape =
    context.kind === "value" && pendingShape?.field === context.field
      ? pendingShape.shape
      : context.kind === "value" && !context.term && !context.inList
        ? shapes[0]
        : context.kind === "value"
          ? (shapes.find((shape) => {
              const current = context.inList
                ? { negated: context.negated, shape: "in" as const }
                : shapeOf(context.term);
              return shape.shape === current.shape && shape.negated === current.negated;
            }) ?? shapes[0])
          : undefined;

  const remoteKey = context.kind === "value" ? `${context.field}\u0000${context.partial}` : "";
  const remoteOptions = remote && remote.key === remoteKey ? remote.options : [];
  const valueOptions = (() => {
    if (context.kind !== "value" || chosenShape?.shape === "has") return [];
    const known = activeField?.options ?? [];
    const merged = [
      ...known,
      ...remoteOptions.filter(
        (option) => !known.some((item) => String(item.value) === String(option.value)),
      ),
    ];
    const chosen = context.inList ? currentValues(context) : [];
    const wanted = listPicked ? "" : context.partial.toLocaleLowerCase();
    return merged.filter(
      (option) =>
        !(listPicked && chosen.includes(String(option.value))) &&
        `${option.label} ${option.value}`.toLocaleLowerCase().includes(wanted),
    );
  })();
  const fieldOptions =
    context.kind === "field" ? rankFields(fields, context.prefix, attributes) : [];
  const showRecent = context.kind === "field" && !draft.trim() && recent.length > 0;

  type Row =
    | { kind: "recent"; query: string }
    | { kind: "field"; field: FilterSearchField }
    | { kind: "value"; option: FilterSearchOption };
  const rows: Row[] = [
    ...(showRecent ? recent.slice(0, 5).map((query) => ({ kind: "recent" as const, query })) : []),
    ...fieldOptions.map((field) => ({ kind: "field" as const, field })),
    ...valueOptions.map((option) => ({ kind: "value" as const, option })),
  ];
  const highlighted = cursor !== null && cursor < rows.length ? cursor : -1;
  const rowId = (index: number) => `${baseId}-row-${index}`;

  // Puts the caret where an edit left it, after React has written the new text. Scrolling the
  // text to the caret fires the input's own scroll event, which moves the coloured copy along.
  useLayoutEffect(() => {
    if (nextCaret.current === null || !inputRef.current) return;
    const position = nextCaret.current;
    nextCaret.current = null;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(position, position);
  }, [draft, caret]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditable(event.target)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  // Server suggestions for the value being typed, once typing pauses and only while the
  // suggestions are showing: a page opened with a query must not ask for them.
  useEffect(() => {
    if (!open || context.kind !== "value" || !suggest || !activeField) return;
    if (activeField.type !== "text" && activeField.type !== "enum") return;
    const controller = new AbortController();
    const key = remoteKey;
    const field = activeField;
    const partial = context.partial;
    const timer = window.setTimeout(() => {
      suggest(field, partial, controller.signal)
        .then((options) => {
          if (!controller.signal.aborted) setRemote({ key, options });
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The field object is rebuilt each render; the key names what is being asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, remoteKey, suggest]);

  const readCaret = () => {
    const input = inputRef.current;
    if (!input) return;
    setCaret(input.selectionStart ?? input.value.length);
    setScrollLeft(input.scrollLeft);
  };
  const edit = (query: string, position: number) => {
    setDraft(query);
    setCaret(position);
    setCursor(null);
    nextCaret.current = position;
  };
  const submit = (query = draft) => {
    const cleaned = query.trim();
    setOpen(false);
    setCursor(null);
    setPendingShape(undefined);
    if (cleaned && recentKey) {
      rememberTerm(recentKey, cleaned);
      setRecent(readRecentTerms(recentKey));
    }
    onSubmit(cleaned || undefined);
  };
  const chooseField = (field: FilterSearchField, ctx: CaretContext) => {
    const name = field.term ?? field.key;
    const negated = ctx.kind === "field" && ctx.negated;
    // A namespace such as "attributes." is only the start of a name: the rest is typed next.
    const text = `${negated ? "!" : ""}${name}${name.endsWith(".") ? "" : ":"}`;
    const result = replaceSpan(draft, ctx.start, ctx.end, text);
    setPendingShape(undefined);
    edit(result.query, result.caret);
    setOpen(true);
  };
  // A declaration, so the value suggestions above can use it.
  function currentValues(ctx: Extract<CaretContext, { kind: "value" }>) {
    if (ctx.term && ctx.term.operator !== "has") return ctx.term.values;
    const token = draft.slice(ctx.start, ctx.end);
    const rest = token.slice(token.indexOf(":") + 1);
    if (!rest.startsWith("[")) return ctx.partial ? [ctx.partial] : [];
    return splitQuery(rest.slice(1).replace(/]$/, "").replace(/,/g, " ")).map((item) =>
      item.replace(/^"|"$/g, ""),
    );
  }
  const chooseValue = (option: FilterSearchOption) => {
    if (context.kind !== "value") return;
    const shape = chosenShape ?? { label: "是", negated: context.negated, shape: "eq" as const };
    const value = String(option.value);
    if (shape.shape === "in") {
      // A half-typed value is replaced by the chosen one; one just picked from the list stays.
      const typed = listPicked ? "" : context.partial;
      const existing = currentValues(context).filter((item) => item && item !== typed);
      const text = writeShape(context.field, shape, [...new Set([...existing, value])]);
      const result = replaceSpan(draft, context.start, context.end, text);
      // Stay inside the list so more values can be picked; Enter runs the search.
      edit(result.query, result.caret - 1);
      setListPicked(true);
      return;
    }
    const text = writeShape(context.field, shape, [value]);
    const result = replaceSpan(draft, context.start, context.end, text);
    edit(result.query, result.caret);
    submit(result.query);
  };
  const chooseShape = (shape: OperatorShape) => {
    if (context.kind !== "value") return;
    const values = currentValues(context).filter(Boolean);
    if (shape.shape === "has" || values.length) {
      const text = writeShape(context.field, shape, values);
      const result = replaceSpan(draft, context.start, context.end, text);
      setPendingShape(undefined);
      edit(result.query, result.caret);
      if (shape.shape === "has") submit(result.query);
      return;
    }
    // No value yet: remember the shape and apply it to the value chosen next.
    setPendingShape({ field: context.field, shape });
    inputRef.current?.focus();
  };
  const addShortcut = (term: string) => {
    const result = replaceSpan(draft, draft.length, draft.length, term);
    edit(result.query, result.caret);
    submit(result.query);
  };
  const activate = (row: Row) => {
    if (row.kind === "recent") {
      edit(row.query, row.query.length);
      submit(row.query);
    } else if (row.kind === "field") chooseField(row.field, context);
    else chooseValue(row.option);
  };

  const errorRange =
    error?.position !== undefined
      ? { start: error.position, end: error.position + Math.max(1, error.term?.length ?? 1) }
      : undefined;
  const parts = highlight(draft);
  const describedTerm =
    context.kind === "value" && context.term && activeField
      ? describeTerm(context.term, (name) => fieldFor(name)?.label ?? name, freeTextLabel)
      : undefined;

  return (
    <div className="search-query">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="search-query__box" data-invalid={error ? "" : undefined}>
            <SearchIcon aria-hidden="true" className="search-query__icon" />
            <div className="search-query__surface">
              <div
                aria-hidden="true"
                className="search-query__highlight"
                style={{ transform: `translateX(${-scrollLeft}px)` }}
              >
                {parts.map((part) => {
                  const invalid =
                    errorRange &&
                    part.start < errorRange.end &&
                    part.start + part.text.length > errorRange.start;
                  return (
                    <span
                      key={part.start}
                      data-kind={part.kind}
                      data-invalid={invalid || undefined}
                    >
                      {part.text}
                    </span>
                  );
                })}
              </div>
              <input
                ref={inputRef}
                className="search-query__input"
                // Phone keyboards show a 搜索 key, which runs the search like Enter.
                enterKeyHint="search"
                role="combobox"
                aria-label={ariaLabel}
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-invalid={error ? true : undefined}
                aria-activedescendant={open && highlighted >= 0 ? rowId(highlighted) : undefined}
                spellCheck={false}
                autoComplete="off"
                placeholder={placeholder}
                value={draft}
                onFocus={() => {
                  setOpen(true);
                  readCaret();
                }}
                onClick={() => {
                  setOpen(true);
                  readCaret();
                }}
                onScroll={readCaret}
                onSelect={readCaret}
                onKeyUp={readCaret}
                onChange={(event) => {
                  setListPicked(false);
                  setDraft(event.target.value);
                  setCaret(event.target.selectionStart ?? event.target.value.length);
                  setCursor(null);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    if (!rows.length) return;
                    event.preventDefault();
                    setOpen(true);
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setCursor(
                      highlighted < 0
                        ? step === 1
                          ? 0
                          : rows.length - 1
                        : (highlighted + step + rows.length) % rows.length,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (open && highlighted >= 0) activate(rows[highlighted]!);
                    else submit();
                  } else if (
                    event.key === "Tab" &&
                    open &&
                    context.kind === "field" &&
                    fieldOptions.length &&
                    context.prefix
                  ) {
                    event.preventDefault();
                    chooseField(
                      highlighted >= 0 && rows[highlighted]?.kind === "field"
                        ? (rows[highlighted] as { field: FilterSearchField }).field
                        : fieldOptions[0]!,
                      context,
                    );
                  } else if (event.key === "Escape") {
                    // Only closes the suggestions: what was typed is the person's work.
                    setOpen(false);
                  }
                }}
              />
            </div>
            {draft ? (
              <button
                type="button"
                className="search-query__clear"
                aria-label="清空查询"
                onClick={() => {
                  edit("", 0);
                  submit("");
                }}
              >
                <XIcon aria-hidden="true" />
              </button>
            ) : null}
            {/* There is no 查询 button: Enter, a chosen value or a has-condition runs the
                search. An edit that has not run yet says so instead of the / hint. */}
            {draft.trim() !== value.trim() ? (
              <span className="search-query__pending">按 Enter 搜索</span>
            ) : (
              <kbd>/</kbd>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const box = inputRef.current?.closest(".search-query__box");
            if (event.target instanceof Node && box?.contains(event.target)) event.preventDefault();
          }}
        >
          <PopoverHeader className="p-3">
            {context.kind === "value" ? (
              <>
                <PopoverTitle>{activeField?.label ?? context.field}</PopoverTitle>
                <PopoverDescription>
                  {describedTerm
                    ? `当前条件：${describedTerm}`
                    : activeField?.hint || "选择条件和值，或直接输入。"}
                </PopoverDescription>
              </>
            ) : (
              <>
                <PopoverTitle>{context.prefix ? "选择字段" : "添加条件"}</PopoverTitle>
                <PopoverDescription>
                  选中的字段会写进查询；条件之间用 AND 连接，全部满足才算匹配。
                </PopoverDescription>
              </>
            )}
          </PopoverHeader>
          {shapes.length ? (
            <div
              role="group"
              aria-label={`${activeField?.label}的条件`}
              className="flex flex-wrap gap-1.5 px-3 pb-3"
            >
              {shapes.map((shape) => {
                const pressed =
                  chosenShape?.shape === shape.shape && chosenShape.negated === shape.negated;
                return (
                  <Button
                    key={`${shape.shape}:${shape.negated}`}
                    type="button"
                    size="sm"
                    variant={pressed ? "default" : "outline"}
                    aria-pressed={pressed}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseShape(shape)}
                  >
                    {shape.label}
                  </Button>
                );
              })}
            </div>
          ) : null}
          {context.kind === "field" && !draft.trim() && shortcuts.length ? (
            <div className="flex flex-wrap gap-2 px-3 pb-3">
              {shortcuts.map((shortcut) => (
                <Button
                  key={shortcut.term}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addShortcut(shortcut.term)}
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>
          ) : null}
          <Separator />
          <div
            role="listbox"
            id={listId}
            aria-label={
              context.kind === "value"
                ? `${activeField?.label ?? context.field}的建议值`
                : "查询建议"
            }
            className="max-h-80 overflow-y-auto p-2"
          >
            <div role="presentation" className="grid gap-1 sm:grid-cols-2">
              {rows.map((row, index) => (
                <Button
                  key={
                    row.kind === "recent"
                      ? `recent:${row.query}`
                      : row.kind === "field"
                        ? `field:${row.field.key}`
                        : `value:${row.option.value}`
                  }
                  id={rowId(index)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  variant="ghost"
                  aria-selected={index === highlighted}
                  data-highlighted={index === highlighted}
                  className={`h-auto min-h-11 justify-start gap-3 rounded-xl px-3 py-2 text-left whitespace-normal data-[highlighted=true]:bg-accent ${row.kind === "recent" ? "sm:col-span-2" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activate(row)}
                >
                  {row.kind === "recent" ? (
                    <>
                      <HistoryIcon aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <code className="search-query__code block">{row.query}</code>
                        <small className="text-muted-foreground">最近搜索</small>
                      </span>
                    </>
                  ) : row.kind === "field" ? (
                    <>
                      <row.field.icon aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <strong className="block font-medium">
                          {row.field.label}{" "}
                          <code className="search-query__code">
                            {row.field.term ?? row.field.key}
                          </code>
                        </strong>
                        <small className="text-muted-foreground">{row.field.hint}</small>
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1">
                      <strong className="block font-medium">{row.option.label}</strong>
                      {row.option.count !== undefined ? (
                        <small className="text-muted-foreground">
                          {row.option.count.toLocaleString()} {row.option.countLabel ?? "条"}
                        </small>
                      ) : null}
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {!rows.length ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                {context.kind === "value"
                  ? chosenShape?.shape === "has"
                    ? "按 Enter 搜索。"
                    : "没有建议值，可直接输入后按 Enter 搜索。"
                  : freeTextLabel
                    ? `按 Enter 在「${freeTextLabel}」中搜索。`
                    : "没有匹配的字段。"}
              </p>
            ) : null}
          </div>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-xs text-muted-foreground">
            <span>
              <code>!</code> 不是 · <code>[a,b]</code> 其中之一 · <code>*值*</code> 包含 ·{" "}
              <code>has:字段</code> 有值 · <code>&gt;</code> 比较
            </span>
            <span>↑↓ 选择 · Enter 搜索 · Esc 关闭</span>
          </div>
        </PopoverContent>
      </Popover>
      {error ? (
        <p className="search-query__error text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function findField(fields: FilterSearchField[], name: string, attributes: boolean) {
  const found = fields.find(
    (field) =>
      (field.term ?? field.key) === name || field.key === name || field.aliases?.includes(name),
  );
  if (found) return found;
  if (attributes && name.startsWith("attributes.") && name.length > "attributes.".length)
    return {
      key: name,
      term: name,
      label: `属性 ${name.slice("attributes.".length)}`,
      hint: "事件上报的自定义属性",
      icon: SearchIcon,
      type: "text" as const,
    };
  return undefined;
}

function rankFields(fields: FilterSearchField[], prefix: string, attributes: boolean) {
  const query = prefix.toLocaleLowerCase();
  const ranked = fields
    .map((field, index) => ({ field, index, score: score(field, query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((item) => item.field);
  if (
    attributes &&
    query.startsWith("attributes.") &&
    query.length > "attributes.".length &&
    !ranked.length
  ) {
    const custom = findField([], prefix, true);
    if (custom) return [custom];
  }
  return ranked;
}

function score(field: FilterSearchField, query: string) {
  if (!query) return 0;
  const terms = [
    field.term ?? field.key,
    field.key,
    field.label,
    field.hint,
    ...(field.aliases ?? []),
  ].map((term) => term.toLocaleLowerCase());
  if (terms.some((term) => term === query)) return 0;
  if (terms.some((term) => term.startsWith(query))) return 1;
  if (terms.some((term) => term.split(/[\s._/-]+/).some((part) => part.startsWith(query))))
    return 2;
  if (terms.some((term) => term.includes(query))) return 3;
  return Number.POSITIVE_INFINITY;
}
