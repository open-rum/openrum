import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { canManageProjects, updateProject, type Project } from "@/lib/api/projects";
import type { UsageResponse } from "@/lib/api/usage";
import { ImpactPreview } from "./ImpactPreview";
import { calculateSamplingImpact } from "./impact";

export function SamplingForm({ project, usage }: { project: Project; usage: UsageResponse }) {
  const queryClient = useQueryClient();
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
      queryClient.setQueryData<{ projects: Project[] }>(
        ["projects", project.organizationId],
        (current) => ({
          projects: (current?.projects ?? []).map((item) =>
            item.id === updated.id ? updated : item,
          ),
        }),
      );
    },
    onError: () => {
      setEventRate(project.eventSampleRate);
      setAPIRate(project.apiSampleRate);
      setErrorRate(project.errorSampleRate);
    },
  });
  const impact = calculateSamplingImpact(usage, eventRate, apiRate, errorRate);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="rounded-lg border border-border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <h2 className="text-lg font-semibold">采样配置</h2>
        <p className="mt-1 text-sm text-muted-foreground">配置将在 5 分钟内分发到在线 SDK。</p>
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
          <Button
            type="submit"
            disabled={
              !canManage ||
              mutation.isPending ||
              (eventRate === project.eventSampleRate &&
                apiRate === project.apiSampleRate &&
                errorRate === project.errorSampleRate)
            }
          >
            {mutation.isPending ? "保存中…" : "保存采样配置"}
          </Button>
          {!canManage ? (
            <span className="text-sm text-muted-foreground">Member / Viewer 仅可查看</span>
          ) : null}
          {mutation.isSuccess ? (
            <span className="text-sm text-emerald-600" role="status">
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
      <ImpactPreview impact={impact} />
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
