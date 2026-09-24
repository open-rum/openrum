import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { canManageProjects, updateProject, type Project } from "@/lib/api/projects";
import type { UsageResponse } from "@/lib/api/usage";
import { ImpactPreview } from "./ImpactPreview";
import { calculateSamplingImpact } from "./impact";

export function SamplingForm({
  project,
  usage,
  previewFallback,
}: {
  project: Project;
  usage?: UsageResponse;
  previewFallback?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [savedProject, setSavedProject] = useState(project);
  const [eventRate, setEventRate] = useState(project.eventSampleRate);
  const [apiRate, setAPIRate] = useState(project.apiSampleRate);
  const [errorRate, setErrorRate] = useState(project.errorSampleRate);
  const canManage = canManageProjects(project.role);
  const mutation = useMutation({
    mutationFn: () =>
      updateProject(project.id, {
        eventSampleRate: eventRate,
        apiSampleRate: apiRate,
        errorSampleRate: errorRate,
      }),
    onSuccess: (updated) => {
      setSavedProject(updated);
      setEventRate(updated.eventSampleRate);
      setAPIRate(updated.apiSampleRate);
      setErrorRate(updated.errorSampleRate);
      queryClient.setQueryData(["project", project.id], updated);
      queryClient.setQueryData<{ projects: Project[] }>(
        ["projects", project.organizationId],
        (current) =>
          current
            ? {
                ...current,
                projects: current.projects.map((item) => (item.id === updated.id ? updated : item)),
              }
            : current,
      );
    },
    onError: () => {
      setEventRate(savedProject.eventSampleRate);
      setAPIRate(savedProject.apiSampleRate);
      setErrorRate(savedProject.errorSampleRate);
    },
  });
  const impact = usage ? calculateSamplingImpact(usage, eventRate, apiRate, errorRate) : undefined;
  const changed =
    eventRate !== savedProject.eventSampleRate ||
    apiRate !== savedProject.apiSampleRate ||
    errorRate !== savedProject.errorSampleRate;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="rounded-lg border border-border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <h3 className="text-base font-medium">事件保留比例</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          100% 表示全部保留，0% 表示不上报该类事件。配置将在 5 分钟内分发到启用远程配置的在线 SDK。
        </p>
        <RateField
          label="页面、性能与自定义事件"
          value={eventRate}
          onChange={setEventRate}
          disabled={!canManage || mutation.isPending}
        />
        <RateField
          label="API 请求事件"
          value={apiRate}
          onChange={setAPIRate}
          disabled={!canManage || mutation.isPending}
        />
        <RateField
          label="错误事件"
          value={errorRate}
          onChange={setErrorRate}
          disabled={!canManage || mutation.isPending}
        />
        <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={!canManage || mutation.isPending || !changed}>
            {mutation.isPending ? "保存中…" : "保存采样配置"}
          </Button>
          {!canManage ? (
            <span className="text-sm text-muted-foreground">Member / Viewer 仅可查看</span>
          ) : null}
          {mutation.isSuccess && !changed ? (
            <span className="text-sm text-(--ds-success)" role="status">
              已保存并开始分发
            </span>
          ) : null}
        </div>
        {mutation.error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            保存失败，已回滚到服务端配置。
          </p>
        ) : null}
      </form>
      <div className="space-y-4">
        {impact ? (
          <ImpactPreview impact={impact} />
        ) : (
          <section
            className="rounded-lg border border-border bg-muted/30 p-5 text-sm leading-6 text-muted-foreground"
            aria-label="用量预估"
          >
            <h3 className="mb-3 font-medium text-foreground">用量预估</h3>
            {previewFallback}
          </section>
        )}
        <p className="text-sm leading-6 text-muted-foreground">
          预估基于最近 7 天、全部环境和事件类型。建议保留 100% 错误事件，优先调整高频行为和 API
          事件。服务器过载时的处理方式请在「速率限制」中设置。
        </p>
      </div>
    </div>
  );
}

function RateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const percentage = Math.round(value * 100);
  return (
    <label className="mt-6 block text-sm font-medium">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <strong>{percentage}%</strong>
      </span>
      <input
        className="mt-3 w-full accent-primary"
        type="range"
        min="0"
        max="100"
        step="1"
        value={percentage}
        disabled={disabled}
        aria-label={`${label}采样率`}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span>100%</span>
      </span>
    </label>
  );
}
