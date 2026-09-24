import { ArrowLeftIcon, ChevronRightIcon, SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onSelect,
  onRemove,
  onSearch,
}: {
  ariaLabel: string;
  placeholder?: string;
  fields: FilterSearchField[];
  tokens: FilterSearchToken[];
  shortcuts?: FilterSearchShortcut[];
  onSelect: (fieldKey: string, value: string | number) => void;
  onRemove: (tokenKey: string) => void;
  onSearch?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string>();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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

  const resetComposer = () => {
    setActiveKey(undefined);
    setDraft("");
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
    if (active?.allowCustom === false) {
      const exact = active.options?.find(
        (option) => option.label.toLocaleLowerCase() === value.toLocaleLowerCase(),
      );
      if (!exact) return;
      onSelect(active.key, exact.value);
    } else if (active) onSelect(active.key, value);
    else onSearch?.(value);
    resetComposer();
  };

  return (
    <div className="filter-search-composer">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <InputGroup className="h-auto min-h-[var(--control-height)] flex-wrap bg-background">
            <InputGroupAddon className="flex-wrap justify-start gap-1.5">
              <SearchIcon aria-hidden="true" />
              {tokens.map((token) => (
                <Badge key={token.key} variant="secondary" className="h-7 gap-1 pl-2.5 pr-0.5">
                  {token.label}
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`移除筛选：${token.label}`}
                    onClick={() => onRemove(token.key)}
                  >
                    <XIcon />
                  </InputGroupButton>
                </Badge>
              ))}
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              className="min-w-44 flex-[1_1_12rem]"
              aria-label={ariaLabel}
              placeholder={active ? `输入${active.label}的值…` : placeholder}
              value={draft}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
                if (event.key === "Backspace" && !draft && tokens.length)
                  onRemove(tokens.at(-1)!.key);
                if (event.key === "Escape") setOpen(false);
              }}
            />
            <InputGroupAddon align="inline-end">
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
            const anchor = inputRef.current?.closest('[data-slot="input-group"]');
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
              <div className="grid max-h-72 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
                {visibleOptions.map((option) => (
                  <Button
                    key={`${active.key}:${option.value}`}
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal"
                    onClick={() => selectValue(option.value)}
                  >
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
                ))}
                {visibleOptions.length === 0 ? (
                  <p className="col-span-full px-3 py-8 text-center text-sm text-muted-foreground">
                    {active.allowCustom === false
                      ? "没有匹配的建议值。"
                      : "没有匹配的建议值，可直接按 Enter 使用当前输入。"}
                  </p>
                ) : null}
              </div>
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
              <div className="grid max-h-80 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
                {visibleFields.map((field) => {
                  const Icon = field.icon;
                  return (
                    <Button
                      key={field.key}
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-14 justify-start gap-3 px-3 py-2 text-left whitespace-normal"
                      onClick={() => {
                        setActiveKey(field.key);
                        setDraft("");
                        inputRef.current?.focus();
                      }}
                    >
                      <Icon aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <strong className="block font-medium">{field.label}</strong>
                        <small className="text-muted-foreground">{field.hint}</small>
                      </span>
                      <ChevronRightIcon data-icon="inline-end" />
                    </Button>
                  );
                })}
                {visibleFields.length === 0 ? (
                  <p className="col-span-full px-3 py-8 text-center text-sm text-muted-foreground">
                    {onSearch ? "按 Enter 将当前内容作为关键词搜索。" : "没有匹配的筛选条件。"}
                  </p>
                ) : null}
              </div>
            </>
          )}
          <Separator />
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <span>{active ? "选择建议值或输入自定义值" : "输入可搜索条件"}</span>
            <span>Enter 添加 · Esc 关闭</span>
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" onClick={commitDraft}>
        查询
      </Button>
    </div>
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
