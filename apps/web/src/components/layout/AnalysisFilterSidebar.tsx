import { useId, useState, type ReactNode } from "react";
import { PanelRightCloseIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import "./analysis-filters.css";

export type AnalysisFilterDefinition = {
  key: string;
  label: string;
  value?: string;
  options: readonly { value: string; label?: string }[];
  text?: boolean;
  maxLength?: number;
  description?: string;
};
const preferenceKey = "openrum.analysis-filters.expanded.v1";

/** Layout and draft controls are shared; pages own supported dimensions and queries. */
export function AnalysisFilterSidebar({
  fields,
  onApply,
  children,
}: {
  fields: readonly AnalysisFilterDefinition[];
  onApply: (values: Record<string, string | undefined>) => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) !== "false";
    } catch {
      return true;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const id = useId();
  const active = fields.filter((field) => field.value);
  const signature = JSON.stringify(fields.map((field) => [field.key, field.value ?? ""]));
  function toggle() {
    setExpanded(!expanded);
    try {
      localStorage.setItem(preferenceKey, String(!expanded));
    } catch {
      /* Preference only. */
    }
  }
  const clear = () => onApply(Object.fromEntries(fields.map((field) => [field.key, undefined])));
  return (
    <div className="analysis-filter-workspace">
      <div className="analysis-filter-toolbar">
        <div className="analysis-filter-chips" aria-label="已应用筛选">
          {active.length ? (
            active.map((field) => (
              <Button
                key={field.key}
                variant="outline"
                size="sm"
                aria-label={`移除${field.label}筛选`}
                onClick={() => onApply({ [field.key]: undefined })}
              >
                <span className="truncate">
                  {field.label}：
                  {field.options.find((option) => option.value === field.value)?.label ??
                    field.value}
                </span>
                <XIcon data-icon="inline-end" />
              </Button>
            ))
          ) : (
            <span>全部数据 · 时间与环境遵循顶部分析范围</span>
          )}
          {active.length ? (
            <Button size="sm" variant="ghost" onClick={clear}>
              清除维度筛选
            </Button>
          ) : null}
        </div>
        <Button
          variant="outline"
          className="analysis-filter-desktop-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={toggle}
        >
          <SlidersHorizontalIcon data-icon="inline-start" />
          {expanded ? "收起筛选" : "展开筛选"}
          {active.length ? ` (${active.length})` : ""}
        </Button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="analysis-filter-mobile-toggle">
              <SlidersHorizontalIcon data-icon="inline-start" />
              筛选{active.length ? ` (${active.length})` : ""}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>维度筛选</SheetTitle>
              <SheetDescription>不同维度同时满足；应用后更新整个分析结果。</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <FilterForm
                key={signature}
                fields={fields}
                onApply={(values) => {
                  onApply(values);
                  setMobileOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <div className="analysis-filter-columns" data-expanded={expanded}>
        <div className="analysis-filter-results">{children}</div>
        {expanded ? (
          <aside id={id} className="analysis-filter-panel" aria-label="维度筛选侧栏">
            <header>
              <div>
                <h2>维度筛选</h2>
                <p>组合条件，缩小排查范围</p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="收起筛选侧栏" onClick={toggle}>
                <PanelRightCloseIcon />
              </Button>
            </header>
            <FilterForm key={signature} fields={fields} onApply={onApply} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function FilterForm({
  fields,
  onApply,
}: {
  fields: readonly AnalysisFilterDefinition[];
  onApply: (values: Record<string, string | undefined>) => void;
}) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value ?? ""])),
  );
  const id = useId();
  const dirty = fields.some((field) => (draft[field.key] ?? "").trim() !== (field.value ?? ""));
  return (
    <form
      className="analysis-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(
          Object.fromEntries(
            fields.map((field) => [field.key, draft[field.key]?.trim() || undefined]),
          ),
        );
      }}
    >
      <FieldGroup>
        {fields.map((field) => (
          <Field key={field.key}>
            <FieldLabel htmlFor={`${id}-${field.key}`}>{field.label}</FieldLabel>
            {field.text ? (
              <>
                <Input
                  id={`${id}-${field.key}`}
                  value={draft[field.key]}
                  onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  list={`${id}-${field.key}-options`}
                  placeholder={`全部${field.label}`}
                  maxLength={field.maxLength ?? 128}
                />
                <datalist id={`${id}-${field.key}-options`}>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
              </>
            ) : (
              <Select
                value={draft[field.key] || "__all__"}
                onValueChange={(value) =>
                  setDraft({ ...draft, [field.key]: value === "__all__" ? "" : value })
                }
              >
                <SelectTrigger id={`${id}-${field.key}`} aria-label={field.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__all__">全部{field.label}</SelectItem>
                    {draft[field.key] &&
                    !field.options.some((option) => option.value === draft[field.key]) ? (
                      <SelectItem value={draft[field.key]}>{draft[field.key]}</SelectItem>
                    ) : null}
                    {field.options
                      .filter((option) => option.value && option.value !== "__all__")
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label ?? option.value}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
            {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
          </Field>
        ))}
      </FieldGroup>
      <div className="analysis-filter-form-actions">
        <Button type="submit" disabled={!dirty}>
          应用筛选
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty}
          onClick={() =>
            setDraft(Object.fromEntries(fields.map((field) => [field.key, field.value ?? ""])))
          }
        >
          撤销修改
        </Button>
      </div>
      <p className="analysis-filter-form-note" aria-live="polite">
        {dirty ? "有未应用的条件" : "条件已应用，收起侧栏不会清除筛选"}
      </p>
    </form>
  );
}
