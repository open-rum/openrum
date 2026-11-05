import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Plus, Trash } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  getScrubRules,
  maxScrubPatterns,
  maxSensitiveKeys,
  newRuleID,
  updateScrubRules,
  type ScrubPattern,
  type ScrubRules,
} from "@/lib/api/processing";
import { canManageProjects, getProject } from "@/lib/api/projects";
import { ProjectDataSettingsShell } from "./ProjectDataSettingsShell";

// Mirrors the built-in fragment list in internal/privacy. Shown rather than
// described so nobody adds a rule for something already covered.
const builtinKeys = [
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "creditcard",
  "cardnumber",
];

export function ProjectScrubbingRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/scrubbing" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const rules = useQuery({
    queryKey: ["project-scrub-rules", projectId],
    queryFn: ({ signal }) => getScrubRules(projectId, signal),
  });
  return (
    <ProjectDataSettingsShell projectId={projectId} section="scrubbing">
      {rules.isLoading ? (
        <AsyncLoading label="正在加载脱敏规则…" />
      ) : rules.error ? (
        <AsyncError
          error={rules.error}
          title="无法加载脱敏规则"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void rules.refetch()}
        />
      ) : rules.data ? (
        <ScrubbingForm
          projectId={projectId}
          initial={rules.data}
          canManage={project.data ? canManageProjects(project.data.role) : false}
          role={project.data?.role}
        />
      ) : null}
    </ProjectDataSettingsShell>
  );
}

function ScrubbingForm({
  projectId,
  initial,
  canManage,
  role,
}: {
  projectId: string;
  initial: ScrubRules;
  canManage: boolean;
  role?: string;
}) {
  const queryClient = useQueryClient();
  // Seeded once and then owned by this form, so a background refetch cannot
  // overwrite what someone is in the middle of typing.
  const [draft, setDraft] = useState<ScrubRules>(initial);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: ScrubRules) => updateScrubRules(projectId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project-scrub-rules", projectId], updated);
      setDraft(updated);
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;

  const setPattern = (index: number, patch: Partial<ScrubPattern>) => {
    setSaved(false);
    setDraft((previous) => ({
      ...previous,
      patterns: previous.patterns.map((pattern, position) =>
        position === index ? { ...pattern, ...patch } : pattern,
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
        <p className="border border-base-300 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          当前角色为 {role ?? "未知"}，只有 Owner 或 Admin 可以修改脱敏规则。
        </p>
      ) : null}

      <section className="border border-base-300 bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="card-title text-lg">追加正则</h2>
          <span className="text-xs text-muted-foreground">
            {draft.patterns.length} / {maxScrubPatterns}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-base-content/70">
          匹配的敏感内容将替换为 <code>[REDACTED]</code>。只影响新写入的数据，历史数据不会被重写。
        </p>
        <details className="collapse collapse-arrow mt-3 border border-base-300">
          <summary className="collapse-title text-sm font-medium">正则语法与执行细节</summary>
          <div className="collapse-content text-sm text-base-content/70">
            规则在服务端执行，使用 Go RE2 语法，不支持回溯引用和环视；匹配空串的表达式会被拒绝。
          </div>
        </details>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          覆盖范围：页面标题、错误类型 / 消息 / 堆栈 / 机制、自定义事件名、面包屑、属性值，以及 URL
          的路径部分（查询串在更早的阶段就已经被丢掉了）。
          <strong>只影响之后写入的数据</strong>，已经入库的不会被重写。
        </p>

        {draft.patterns.length === 0 ? (
          <p className="mt-5 border border-dashed border-base-300 px-4 py-6 text-center text-sm text-muted-foreground">
            还没有追加规则。内置那几条覆盖不到的业务标识符——订单号、工单号、内部账号——放在这里。
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {draft.patterns.map((pattern, index) => (
              <li key={pattern.id} className="card card-border bg-base-100 p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Field label="正则">
                    <input
                      value={pattern.expression}
                      disabled={disabled}
                      required
                      maxLength={200}
                      aria-label={`正则 ${index + 1}`}
                      placeholder="ORD-[0-9]{6}"
                      onChange={(event) => setPattern(index, { expression: event.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`删除正则 ${index + 1}`}
                    onClick={() => {
                      setSaved(false);
                      setDraft((previous) => ({
                        ...previous,
                        patterns: previous.patterns.filter((_, position) => position !== index),
                      }));
                    }}
                  >
                    <Trash className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-3">
                  <Field label="备注" hint="可选，帮后来者理解这条规则在挡什么">
                    <input
                      value={pattern.note ?? ""}
                      disabled={disabled}
                      maxLength={200}
                      aria-label={`正则 ${index + 1} 的备注`}
                      onChange={(event) => setPattern(index, { note: event.target.value })}
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
          disabled={disabled || draft.patterns.length >= maxScrubPatterns}
          onClick={() => {
            setSaved(false);
            setDraft((previous) => ({
              ...previous,
              patterns: [...previous.patterns, { id: newRuleID("s"), expression: "", note: "" }],
            }));
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          添加正则
        </Button>
      </section>

      <section className="border border-base-300 bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="card-title text-lg">敏感 key</h2>
          <span className="text-xs text-muted-foreground">
            {draft.sensitiveKeys.length} / {maxSensitiveKeys}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          命中的属性和面包屑字段会被<strong>整个丢掉</strong>，不是替换成标记。匹配忽略大小写和{" "}
          <code>-</code> <code>_</code> <code>.</code>，且是子串匹配：填 <code>ssn</code> 就同时覆盖{" "}
          <code>user_SSN</code> 和 <code>ssn-last4</code>。
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          已内置：{builtinKeys.join("、")}。这些不用再填。
        </p>

        <ul className="mt-5 flex flex-col gap-3">
          {draft.sensitiveKeys.map((key, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={`敏感 key ${index + 1}`}>
                  <input
                    value={key}
                    disabled={disabled}
                    required
                    maxLength={64}
                    aria-label={`敏感 key ${index + 1}`}
                    placeholder="ssn"
                    onChange={(event) => {
                      const next = event.target.value;
                      setSaved(false);
                      setDraft((previous) => ({
                        ...previous,
                        sensitiveKeys: previous.sensitiveKeys.map((current, position) =>
                          position === index ? next : current,
                        ),
                      }));
                    }}
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label={`删除敏感 key ${index + 1}`}
                onClick={() => {
                  setSaved(false);
                  setDraft((previous) => ({
                    ...previous,
                    sensitiveKeys: previous.sensitiveKeys.filter(
                      (_, position) => position !== index,
                    ),
                  }));
                }}
              >
                <Trash className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          className="mt-5"
          disabled={disabled || draft.sensitiveKeys.length >= maxSensitiveKeys}
          onClick={() => {
            setSaved(false);
            setDraft((previous) => ({
              ...previous,
              sensitiveKeys: [...previous.sensitiveKeys, ""],
            }));
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          添加 key
        </Button>
      </section>

      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          保存失败：{mutation.error instanceof Error ? mutation.error.message : "未知错误"}
        </p>
      ) : null}

      <div className="flex flex-row-reverse flex-wrap justify-start items-center gap-3">
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
    <label className="flex flex-col gap-1.5 text-sm [&_input:not([type=checkbox],[type=radio])]:input [&_input:not([type=checkbox],[type=radio])]:w-full [&_select]:select [&_select]:w-full [&_textarea]:textarea [&_textarea]:w-full">
      <span className="font-medium text-base-content">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
