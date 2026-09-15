import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Plus, Trash } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  getURLRules,
  maxURLRules,
  newRuleID,
  updateURLRules,
  urlRuleTargetLabels,
  type URLRule,
  type URLRuleTarget,
  type URLRules,
} from "@/lib/api/processing";
import { canManageProjects, getProject } from "@/lib/api/projects";
import { ProjectSettingsLayout } from "./ProjectSettingsLayout";

const targets = Object.keys(urlRuleTargetLabels) as URLRuleTarget[];

export function ProjectURLRulesRoute() {
  const { projectId } = useParams({ from: "/protected/projects/$projectId/settings/url-rules" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const rules = useQuery({
    queryKey: ["project-url-rules", projectId],
    queryFn: ({ signal }) => getURLRules(projectId, signal),
  });
  return (
    <ProjectSettingsLayout
      projectId={projectId}
      titleId="project-url-rules-title"
      title="URL 归一化"
      description="把同一个路由的不同地址合成一行。内置规则已经能认出 UUID、纯数字、长十六进制和长不透明串；这里补的是它认不出来的那些，比如四位短 slug。"
    >
      {rules.isLoading ? (
        <AsyncLoading label="正在加载归一化规则…" />
      ) : rules.error ? (
        <AsyncError
          error={rules.error}
          title="无法加载归一化规则"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void rules.refetch()}
        />
      ) : rules.data ? (
        <URLRulesForm
          projectId={projectId}
          initial={rules.data}
          canManage={project.data ? canManageProjects(project.data.role) : false}
          role={project.data?.role}
        />
      ) : null}
    </ProjectSettingsLayout>
  );
}

function URLRulesForm({
  projectId,
  initial,
  canManage,
  role,
}: {
  projectId: string;
  initial: URLRules;
  canManage: boolean;
  role?: string;
}) {
  const queryClient = useQueryClient();
  // Seeded once and then owned by this form. A background refetch must not
  // overwrite what someone is in the middle of typing, so the server copy is
  // only adopted again after a save succeeds.
  const [draft, setDraft] = useState<URLRules>(initial);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: URLRules) => updateURLRules(projectId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project-url-rules", projectId], updated);
      setDraft(updated);
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;

  const setRule = (index: number, patch: Partial<URLRule>) => {
    setSaved(false);
    setDraft((previous) => ({
      rules: previous.rules.map((rule, position) =>
        position === index ? { ...rule, ...patch } : rule,
      ),
    }));
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.rules.length) return;
    setSaved(false);
    setDraft((previous) => {
      const rules = [...previous.rules];
      [rules[index], rules[target]] = [rules[target], rules[index]];
      return { rules };
    });
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
          当前角色为 {role ?? "未知"}，只有 Owner 或 Admin 可以修改归一化规则。
        </p>
      ) : null}

      <section className="border border-border bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">路径模板</h2>
          <span className="text-xs text-muted-foreground">
            {draft.rules.length} / {maxURLRules}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          写法就是你希望在列表里看到的那一行：<code>/orders/:orderId</code> 会把{" "}
          <code>/orders/8fc1</code> 和 <code>/orders/9ab2</code> 合成 <code>/orders/:orderId</code>
          。<code>:名字</code> 匹配任意一段，末尾的 <code>*</code>{" "}
          吃掉剩下所有段（但不包含父级本身）。 段数必须对得上，字面段不区分大小写。
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          规则<strong>自上而下</strong>取第一条命中的，所以具体的要放在宽泛的上面。规则只在 Consumer
          执行，改动约 30 秒内生效，且<strong>只影响之后写入的数据</strong>，不会重写历史。
        </p>

        {draft.rules.length === 0 ? (
          <p className="mt-5 border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            还没有规则。先去页面或 API 列表看看哪些行明显是同一个路由被拆开了。
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {draft.rules.map((rule, index) => (
              <li key={rule.id} className="border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
                  <Field label="应用于">
                    <select
                      value={rule.target}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 应用于`}
                      onChange={(event) =>
                        setRule(index, { target: event.target.value as URLRuleTarget })
                      }
                    >
                      {targets.map((target) => (
                        <option key={target} value={target}>
                          {urlRuleTargetLabels[target]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="路径模板">
                    <input
                      value={rule.pattern}
                      disabled={disabled}
                      required
                      maxLength={200}
                      aria-label={`规则 ${index + 1} 的路径模板`}
                      placeholder="/orders/:orderId"
                      onChange={(event) => setRule(index, { pattern: event.target.value })}
                    />
                  </Field>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled || index === 0}
                      aria-label={`把规则 ${index + 1} 上移`}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled || index === draft.rules.length - 1}
                      aria-label={`把规则 ${index + 1} 下移`}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`删除规则 ${index + 1}`}
                      onClick={() => {
                        setSaved(false);
                        setDraft((previous) => ({
                          rules: previous.rules.filter((_, position) => position !== index),
                        }));
                      }}
                    >
                      <Trash className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
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
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          className="mt-5"
          disabled={disabled || draft.rules.length >= maxURLRules}
          onClick={() => {
            setSaved(false);
            setDraft((previous) => ({
              rules: [
                ...previous.rules,
                { id: newRuleID("u"), target: "both", pattern: "", note: "" },
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
            已保存。Consumer 约 30 秒内生效。
          </span>
        ) : null}
      </div>
    </form>
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
