import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { Plus, Trash } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  BODY_LIMIT_KB,
  captureMethods,
  getAPICapture,
  splitHeaderNames,
  updateAPICapture,
  type APICapture,
  type CaptureRule,
} from "@/lib/api/apiCapture";
import { canManageProjects, getProject } from "@/lib/api/projects";
import { ProjectDataSettingsShell } from "./ProjectDataSettingsShell";

// What the explanation offers as a starting point. Typed into the form only when a rule is
// started from an endpoint, and saved only if the person keeps it.
const suggestedResponseHeaders = "content-type, x-request-id";

type DraftRule = {
  id: string;
  method: string;
  pattern: string;
  requestText: string;
  responseText: string;
  requestBody: boolean;
  responseBody: boolean;
  note: string;
};

export function ProjectAPICaptureRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/api-capture" });
  const search = useSearch({ from: "/protected/settings/project/$projectId/api-capture" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const capture = useQuery({
    queryKey: ["project-api-capture", projectId],
    queryFn: ({ signal }) => getAPICapture(projectId, signal),
  });
  return (
    <ProjectDataSettingsShell projectId={projectId} section="api-capture">
      {capture.isLoading ? (
        <AsyncLoading label="正在加载头信息采集设置…" />
      ) : capture.error ? (
        <AsyncError
          error={capture.error}
          title="无法加载头信息采集设置"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void capture.refetch()}
        />
      ) : capture.data ? (
        <APICaptureForm
          projectId={projectId}
          initial={capture.data}
          start={search.url ? { method: search.method, url: search.url } : undefined}
          canManage={project.data ? canManageProjects(project.data.role) : false}
          role={project.data?.role}
        />
      ) : null}
    </ProjectDataSettingsShell>
  );
}

export function APICaptureForm({
  projectId,
  initial,
  start,
  canManage,
  role,
}: {
  projectId: string;
  initial: APICapture;
  /** An endpoint API monitoring linked here with, to start a rule from. */
  start?: { method?: string; url: string };
  canManage: boolean;
  role?: string;
}) {
  const queryClient = useQueryClient();
  // Seeded once and then owned by this form, so a background refetch cannot overwrite what is
  // being typed. The server copy is adopted again only after a save succeeds.
  const [draft, setDraft] = useState<DraftRule[]>(() => seed(initial.rules, start));
  const [started] = useState(() => Boolean(start && !hasRule(initial.rules, start)));
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (rules: DraftRule[]) => updateAPICapture(projectId, rules.map(toRule)),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project-api-capture", projectId], updated);
      setDraft(updated.rules.map(fromRule));
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;
  const patch = (index: number, change: Partial<DraftRule>) => {
    setSaved(false);
    setDraft((previous) =>
      previous.map((rule, position) => (position === index ? { ...rule, ...change } : rule)),
    );
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
          当前角色为 {role ?? "未知"}，只有 Owner 或 Admin 可以修改采集规则。
        </p>
      ) : null}

      <section className="border border-border bg-card p-6" aria-labelledby="capture-rules-intro">
        <h2 id="capture-rules-intro" className="text-lg font-semibold text-foreground">
          怎么工作
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
          <li>
            <strong>默认全部不采集。</strong>
            没有规则时，SDK 不读取任何头，服务端也不会存。
          </li>
          <li>
            每条规则只作用于它匹配的 API，并且只记录你列出的头名。规则只对<strong>开启之后</strong>
            的新请求生效。
          </li>
          <li>
            <strong>凭证类头永远不会采集</strong>：名字里含 auth、cookie、token、secret、password、
            session、csrf、signature、api-key，以及 x-forwarded-for 这类客户端地址头。这是硬规则，
            无法配置。
          </li>
          <li>
            头值里的邮箱、Bearer、JWT、银行卡号会被自动遮盖，每个值最多 256 个字符，每个方向最多{" "}
            {initial.maxHeaders} 个头。
          </li>
          <li>
            <strong>请求体和响应体需要单独勾选。</strong>
            只读取文本、JSON 和表单，超过 64 KB 的不采集，其余最多保留 {BODY_LIMIT_KB} KB。 JSON
            里名字含 password、token、secret、cardNumber、email、phone 等的字段，值会被替换成{" "}
            <code>[REDACTED]</code>，邮箱、Bearer、JWT 和银行卡号也会被遮盖。
          </li>
          <li>
            记录的头和内容在 <strong>{initial.retentionDays} 天</strong>
            后自动删除，期间项目内所有成员都能在 API
            监控的请求详情里看到。请只列出对排查有用、且不含个人信息的头。
          </li>
        </ul>
      </section>

      <section className="border border-border bg-card p-6" aria-labelledby="capture-rules-list">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="capture-rules-list" className="text-lg font-semibold text-foreground">
            采集规则
          </h2>
          <span className="text-xs text-muted-foreground">
            {draft.length} / {initial.maxRules}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          地址写成 API 监控里显示的样子，例如 <code>https://api.example.com/orders/:id</code>，
          <code>:id</code> 代表一个标识符段。可以用 <code>*</code>{" "}
          匹配一类地址，不支持正则，不区分大小写。头名用小写字母，多个用逗号或空格分隔。
        </p>
        {started && !saved ? (
          <p
            role="status"
            className="mt-4 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          >
            已按你在 API 监控中查看的端点预填了一条规则。核对头名后保存才会生效。
          </p>
        ) : null}

        {draft.length === 0 ? (
          <p className="mt-5 border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            还没有规则，所有 API 的头信息都不采集。
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {draft.map((rule, index) => (
              <li key={rule.id} className="border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end">
                  <Field label="方法">
                    <select
                      value={rule.method}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 的方法`}
                      onChange={(event) => patch(index, { method: event.target.value })}
                    >
                      {captureMethods.map((method) => (
                        <option key={method} value={method}>
                          {method === "*" ? "任意" : method}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="API 地址">
                    <input
                      value={rule.pattern}
                      disabled={disabled}
                      required
                      maxLength={300}
                      aria-label={`规则 ${index + 1} 的 API 地址`}
                      placeholder="https://api.example.com/orders/:id"
                      onChange={(event) => patch(index, { pattern: event.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`删除规则 ${index + 1}`}
                    onClick={() => {
                      setSaved(false);
                      setDraft((previous) => previous.filter((_, position) => position !== index));
                    }}
                  >
                    <Trash className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="请求头" hint="例如 x-request-id, accept">
                    <input
                      value={rule.requestText}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 的请求头`}
                      placeholder="留空表示不采集请求头"
                      onChange={(event) => patch(index, { requestText: event.target.value })}
                    />
                  </Field>
                  <Field label="响应头" hint="例如 content-type, cache-control, etag">
                    <input
                      value={rule.responseText}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 的响应头`}
                      placeholder="留空表示不采集响应头"
                      onChange={(event) => patch(index, { responseText: event.target.value })}
                    />
                  </Field>
                </div>
                <fieldset className="mt-3 flex flex-col gap-2 text-sm">
                  <legend className="font-medium text-foreground">内容（正文）</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.requestBody}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 采集请求体`}
                      onChange={(event) => patch(index, { requestBody: event.target.checked })}
                    />
                    采集请求体
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.responseBody}
                      disabled={disabled}
                      aria-label={`规则 ${index + 1} 采集响应体`}
                      onChange={(event) => patch(index, { responseBody: event.target.checked })}
                    />
                    采集响应体
                  </label>
                  {rule.requestBody || rule.responseBody ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      正文常含个人信息。只读取文本、JSON 和表单，最多保留 {BODY_LIMIT_KB} KB； 含
                      password、token、cardNumber、email
                      等名字的字段会被遮盖，但无法识别所有自由文本， 请只对确有需要的 API 开启。
                    </p>
                  ) : null}
                </fieldset>
                <div className="mt-3">
                  <Field label="备注" hint="可选，说明为什么要采集">
                    <input
                      value={rule.note}
                      disabled={disabled}
                      maxLength={200}
                      aria-label={`规则 ${index + 1} 的备注`}
                      onChange={(event) => patch(index, { note: event.target.value })}
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
          disabled={disabled || draft.length >= initial.maxRules}
          onClick={() => {
            setSaved(false);
            setDraft((previous) => [...previous, blankRule()]);
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

function seed(rules: CaptureRule[], start?: { method?: string; url: string }): DraftRule[] {
  const drafts = rules.map(fromRule);
  if (!start || hasRule(rules, start)) return drafts;
  return [
    ...drafts,
    {
      ...blankRule(),
      method: start.method && captureMethods.includes(start.method) ? start.method : "*",
      pattern: start.url,
      responseText: suggestedResponseHeaders,
    },
  ];
}

function hasRule(rules: CaptureRule[], start: { method?: string; url: string }) {
  return rules.some(
    (rule) =>
      rule.pattern.toLowerCase() === start.url.toLowerCase() &&
      (rule.method === "*" || rule.method === (start.method ?? "*")),
  );
}

function blankRule(): DraftRule {
  // Readable in the stored document and unique without a round trip, so a rule can be added
  // and removed again before anything is saved.
  return {
    id: `r_${Math.random().toString(36).slice(2, 10)}`,
    method: "*",
    pattern: "",
    requestText: "",
    responseText: "",
    requestBody: false,
    responseBody: false,
    note: "",
  };
}

function fromRule(rule: CaptureRule): DraftRule {
  return {
    id: rule.id,
    method: rule.method,
    pattern: rule.pattern,
    requestText: rule.requestHeaders.join(", "),
    responseText: rule.responseHeaders.join(", "),
    requestBody: rule.requestBody,
    responseBody: rule.responseBody,
    note: rule.note ?? "",
  };
}

function toRule(rule: DraftRule): CaptureRule {
  return {
    id: rule.id,
    method: rule.method,
    pattern: rule.pattern.trim(),
    requestHeaders: splitHeaderNames(rule.requestText),
    responseHeaders: splitHeaderNames(rule.responseText),
    requestBody: rule.requestBody,
    responseBody: rule.responseBody,
    ...(rule.note.trim() ? { note: rule.note.trim() } : {}),
  };
}
