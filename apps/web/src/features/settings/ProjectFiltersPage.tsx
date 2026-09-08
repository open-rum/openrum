import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Plus, Trash } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  builtinLabels,
  filterKindLabels,
  filterModeLabels,
  getInboundFilters,
  updateInboundFilters,
  type FilterKind,
  type FilterMode,
  type FilterRule,
  type InboundFilters,
} from "@/lib/api/filters";
import { canManageProjects, getProject } from "@/lib/api/projects";
import { ProjectSettingsLayout } from "./ProjectSettingsLayout";

const modes: FilterMode[] = ["off", "dry_run", "enforced"];
const kinds = Object.keys(filterKindLabels) as FilterKind[];
const maxRules = 50;

export function ProjectFiltersRoute() {
  const { projectId } = useParams({ from: "/protected/projects/$projectId/settings/filters" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const filters = useQuery({
    queryKey: ["project-filters", projectId],
    queryFn: ({ signal }) => getInboundFilters(projectId, signal),
  });
  return (
    <ProjectSettingsLayout
      projectId={projectId}
      titleId="project-filters-title"
      breadcrumb={`项目 / ${project.data?.name ?? "…"} / 入站过滤`}
      title="入站过滤"
      description="决定哪些上报不进入你的数据。规则由 Consumer 权威执行；浏览器 SDK 会提前丢弃其中一部分，那只是省带宽。"
    >
      {filters.isLoading ? (
        <AsyncLoading label="正在加载过滤设置…" />
      ) : filters.error ? (
        <AsyncError
          error={filters.error}
          title="无法加载过滤设置"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void filters.refetch()}
        />
      ) : filters.data ? (
        <FiltersForm
          projectId={projectId}
          initial={filters.data}
          canManage={project.data ? canManageProjects(project.data.role) : false}
          role={project.data?.role}
        />
      ) : null}
    </ProjectSettingsLayout>
  );
}

function FiltersForm({
  projectId,
  initial,
  canManage,
  role,
}: {
  projectId: string;
  initial: InboundFilters;
  canManage: boolean;
  role?: string;
}) {
  const queryClient = useQueryClient();
  // Seeded once and then owned by this form. A background refetch must not
  // overwrite what someone is in the middle of typing, so the server copy is
  // only adopted again after a save succeeds.
  const [draft, setDraft] = useState<InboundFilters>(initial);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: InboundFilters) => updateInboundFilters(projectId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project-filters", projectId], updated);
      setDraft(updated);
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;

  const setBuiltin = (reason: string, mode: FilterMode) => {
    setSaved(false);
    setDraft((previous) => ({ ...previous, builtin: { ...previous.builtin, [reason]: mode } }));
  };
  const setRule = (index: number, patch: Partial<FilterRule>) => {
    setSaved(false);
    setDraft((previous) => ({
      ...previous,
      rules: previous.rules.map((rule, position) =>
        position === index ? { ...rule, ...patch } : rule,
      ),
    }));
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(draft);
      }}
    >
      {!canManage ? (
        <p className="border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          当前角色为 {role ?? "未知"}，只有 Owner 或 Admin 可以修改过滤设置。
        </p>
      ) : null}

      <section className="border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">内置类别</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          三种状态：<strong>关闭</strong>完全不看；<strong>仅统计</strong>
          照常入库但记录命中量，用来在动手之前先量清影响；
          <strong>丢弃</strong>才真正不入库。建议先用仅统计跑一段时间再决定。
        </p>
        <ul className="mt-5 flex flex-col gap-5">
          {Object.entries(draft.builtin).map(([reason, mode]) => (
            <li
              key={reason}
              className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 sm:pr-6">
                <p className="text-sm font-medium text-foreground">
                  {builtinLabels[reason]?.title ?? reason}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {builtinLabels[reason]?.description ?? ""}
                </p>
              </div>
              <ModeSelect
                value={mode}
                disabled={disabled}
                label={`${builtinLabels[reason]?.title ?? reason} 的处理方式`}
                onChange={(next) => setBuiltin(reason, next)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-border bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">自定义规则</h2>
          <span className="text-xs text-muted-foreground">
            {draft.rules.length} / {maxRules}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          匹配用通配符 <code>*</code>
          ，不支持正则，且不区分大小写。同一条模式要在服务端和浏览器两个引擎上跑，
          只有单一通配符能保证两边含义完全一致。
        </p>

        {draft.rules.length === 0 ? (
          <p className="mt-5 border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            还没有自定义规则。内置类别覆盖不到的噪声可以在这里补。
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {draft.rules.map((rule, index) => (
              <li key={rule.id} className="border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_8rem_auto] sm:items-end">
                  <Field label="匹配字段">
                    <select
                      value={rule.kind}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 的匹配字段`}
                      onChange={(event) =>
                        setRule(index, { kind: event.target.value as FilterKind })
                      }
                    >
                      {kinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {filterKindLabels[kind]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="模式">
                    <input
                      value={rule.pattern}
                      disabled={disabled}
                      required
                      maxLength={200}
                      aria-label={`规则 ${index + 1} 的匹配模式`}
                      placeholder="ResizeObserver loop*"
                      onChange={(event) => setRule(index, { pattern: event.target.value })}
                    />
                  </Field>
                  <Field label="处理方式">
                    <ModeSelect
                      value={rule.mode}
                      disabled={disabled}
                      label={`规则 ${index + 1} 的处理方式`}
                      onChange={(next) => setRule(index, { mode: next })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`删除规则 ${index + 1}`}
                    onClick={() => {
                      setSaved(false);
                      setDraft((previous) => ({
                        ...previous,
                        rules: previous.rules.filter((_, position) => position !== index),
                      }));
                    }}
                  >
                    <Trash className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-3">
                  <Field label="备注" hint="可选，帮后来者理解这条规则为什么存在">
                    <input
                      value={rule.note ?? ""}
                      disabled={disabled}
                      maxLength={200}
                      aria-label={`规则 ${index + 1} 的备注`}
                      onChange={(event) => setRule(index, { note: event.target.value })}
                    />
                  </Field>
                </div>
                {rule.kind === "page_url" ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    页面地址规则只在服务端执行。匹配的是路径中的 ID 段被替换成 <code>:id</code>{" "}
                    之后的形式，浏览器无法复现，因此不会下发给 SDK。
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          className="mt-5"
          disabled={disabled || draft.rules.length >= maxRules}
          onClick={() => {
            setSaved(false);
            setDraft((previous) => ({
              ...previous,
              rules: [
                ...previous.rules,
                {
                  id: newRuleID(),
                  kind: "error_message",
                  pattern: "",
                  // New rules start by measuring, so adding one cannot lose
                  // data before its author has seen what it matches.
                  mode: "dry_run",
                },
              ],
            }));
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          添加规则
        </Button>
      </section>

      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          保存失败：{mutation.error instanceof Error ? mutation.error.message : "未知错误"}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {mutation.isPending ? "保存中…" : "保存"}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-muted-foreground">
            已保存。浏览器最多约 5 分钟后拿到新配置，Consumer 约 30 秒内生效。
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ModeSelect({
  value,
  disabled,
  label,
  onChange,
}: {
  value: FilterMode;
  disabled: boolean;
  label: string;
  onChange: (mode: FilterMode) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={label}
      className="min-w-28"
      onChange={(event) => onChange(event.target.value as FilterMode)}
    >
      {modes.map((mode) => (
        <option key={mode} value={mode}>
          {filterModeLabels[mode]}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

// Readable in the stored document and unique without a round trip, so a rule
// can be added and removed again before anything is saved.
function newRuleID() {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}
