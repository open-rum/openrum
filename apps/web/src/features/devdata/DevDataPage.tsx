import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseIcon, PlayIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  devDataWindows,
  generateDevData,
  getDevDataPresets,
  readStoredDSN,
  storeDSN,
  type DevDataResult,
  type DevDataScenario,
} from "@/lib/api/devData";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { ProjectSettingsNav } from "@/features/settings/ProjectSettingsNav";
import "./devdata.css";

const eventTypeLabels: Record<string, string> = {
  page_view: "页面浏览",
  api: "API 请求",
  web_vital: "Web Vitals",
  error: "错误",
  custom: "自定义事件",
  log: "日志",
};

export function DevDataPage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <DevDataSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={DatabaseIcon}
        title="尚未创建项目"
        description="先创建一个项目，才能为它生成开发数据。"
      />
    );
  return <ProjectDevData project={project} />;
}

function ProjectDevData({ project }: { project: Project }) {
  const [preset, setPreset] = useState("storefront");
  const [minutes, setMinutes] = useState<number>(1_440);
  const [sessions, setSessions] = useState(300);
  const [dsn, setDSN] = useState(readStoredDSN);
  const [advanced, setAdvanced] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [editedBasis, setEditedBasis] = useState("");
  const [draftError, setDraftError] = useState("");

  const presets = useQuery({
    queryKey: ["dev-data-presets", project.id, preset, minutes],
    queryFn: () => getDevDataPresets(project.id, preset, minutes),
  });

  // The editor shows what the server currently offers until the user changes
  // it. Picking a different preset or window is a request for a new starting
  // point, so it discards the edit rather than silently keeping the old one.
  const offered = presets.data ? JSON.stringify(presets.data.scenario, null, 2) : "";
  if (offered && offered !== editedBasis) {
    setEditedBasis(offered);
    setEdited(null);
  }
  const draft = edited ?? offered;
  const setDraft = setEdited;

  const generate = useMutation({
    mutationFn: () => {
      let scenario: DevDataScenario | undefined;
      if (advanced && draft.trim()) scenario = JSON.parse(draft) as DevDataScenario;
      return generateDevData(project.id, {
        dsn,
        preset,
        minutes,
        sessions: advanced ? undefined : sessions,
        scenario,
      });
    },
  });

  const activePreset = presets.data?.presets.find((item) => item.id === preset);
  const canSubmit = dsn.trim().length > 0 && !generate.isPending;

  return (
    <ConsolePage
      width="wide"
      rail={<ProjectSettingsNav projectId={project.id} />}
      railLabel="项目设置导航"
    >
      <ConsolePageHeader
        title="开发数据生成器"
        description="按场景生成事件并投递到真实 ingest 接口。数据会经过与线上完全相同的校验、URL 归一化、指纹与聚合，因此在这里验证过的查询结果是可信的。"
        actions={<Badge variant="outline">{project.environment}</Badge>}
      />
      <section className="devdata" aria-label="开发数据生成器">
        <div className="devdata-grid">
          <fieldset className="devdata-field">
            <legend>场景</legend>
            <div className="devdata-presets">
              {presets.data?.presets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-active={item.id === preset}
                  onClick={() => setPreset(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            {activePreset ? <p className="devdata-hint">{activePreset.description}</p> : null}
          </fieldset>

          <fieldset className="devdata-field">
            <legend>时间范围</legend>
            <div className="devdata-windows">
              {devDataWindows.map((item) => (
                <button
                  key={item.minutes}
                  type="button"
                  data-active={item.minutes === minutes}
                  onClick={() => setMinutes(item.minutes)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="devdata-hint">
              会话会均匀铺开在该区间内，因此分钟级聚合和趋势图才有形状。回填历史时间是安全的：管道只会重写
              2000 年以前或超前 24 小时的时间戳。
            </p>
          </fieldset>

          <label className="devdata-field">
            <span>会话数</span>
            <input
              type="number"
              min={1}
              max={5_000}
              value={sessions}
              disabled={advanced}
              onChange={(input) => setSessions(Number(input.target.value))}
            />
            <p className="devdata-hint">
              {advanced ? "高级模式下由场景 JSON 中的 sessions 决定。" : "上限 5000。"}
            </p>
          </label>

          <label className="devdata-field">
            <span>客户端 DSN</span>
            <input
              type="text"
              value={dsn}
              placeholder="https://orr_pk_...@rum.example.com/ingest/v1/envelope"
              autoComplete="off"
              onChange={(input) => {
                setDSN(input.target.value);
                storeDSN(input.target.value);
              }}
            />
            <p className="devdata-hint">
              DSN 与 Browser SDK 使用同一个；填过之后会记在本浏览器里。
            </p>
          </label>
        </div>

        <div className="devdata-advanced">
          <label>
            <input
              type="checkbox"
              checked={advanced}
              onChange={(input) => setAdvanced(input.target.checked)}
            />
            编辑完整场景 JSON
          </label>
          {advanced ? (
            <>
              <textarea
                value={draft}
                spellCheck={false}
                rows={18}
                aria-label="场景 JSON"
                onChange={(input) => {
                  setDraft(input.target.value);
                  setDraftError("");
                }}
              />
              <p className="devdata-hint">
                可以自由增删 journey、page、api、vital 和错误。environment 与 baseUrl
                会由服务端按项目 覆盖，避免 ingest 因环境不符或来源不在白名单而整批拒收。
              </p>
              {draftError ? <p className="devdata-error">{draftError}</p> : null}
            </>
          ) : null}
        </div>

        <div className="devdata-actions">
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (advanced && draft.trim()) {
                try {
                  JSON.parse(draft);
                } catch (error) {
                  setDraftError(`场景 JSON 无法解析：${(error as Error).message}`);
                  return;
                }
              }
              setDraftError("");
              generate.mutate();
            }}
          >
            <PlayIcon data-icon="inline-start" aria-hidden />
            {generate.isPending ? "生成中…" : "生成并投递"}
          </Button>
          {!dsn.trim() ? <span className="devdata-hint">填入客户端 DSN 后即可生成。</span> : null}
        </div>

        {presets.isError ? (
          <AsyncError
            error={presets.error}
            title="场景加载失败"
            remediation="确认 API 服务运行在 development 环境，该接口只在开发环境注册。"
            onRetry={() => void presets.refetch()}
          />
        ) : null}
        {generate.isError ? (
          <p className="devdata-error" role="alert">
            {(generate.error as Error).message}
          </p>
        ) : null}
        {generate.data ? <DevDataOutcome result={generate.data} /> : null}
      </section>
    </ConsolePage>
  );
}

function DevDataOutcome({ result }: { result: DevDataResult }) {
  const breakdown = useMemo(
    () =>
      Object.entries(result.summary.byType)
        .map(([type, count]) => ({ label: eventTypeLabels[type] ?? type, count }))
        .sort((left, right) => right.count - left.count),
    [result.summary.byType],
  );
  return (
    <section className="devdata-result" aria-label="生成结果">
      <div className="devdata-result-cards">
        <div>
          <span>会话</span>
          <strong>{result.summary.sessions.toLocaleString()}</strong>
        </div>
        <div>
          <span>已接收事件</span>
          <strong>{result.accepted.toLocaleString()}</strong>
        </div>
        <div>
          <span>被拒事件</span>
          <strong data-warn={result.rejected > 0}>{result.rejected.toLocaleString()}</strong>
        </div>
        <div>
          <span>投递失败批次</span>
          <strong data-warn={result.failed > 0}>{result.failed.toLocaleString()}</strong>
        </div>
        <div>
          <span>耗时</span>
          <strong>{(result.elapsedMs / 1_000).toFixed(1)}s</strong>
        </div>
      </div>
      <ul className="devdata-breakdown">
        {breakdown.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <strong>{item.count.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
      <p className="devdata-hint">{result.message}</p>
    </section>
  );
}

function DevDataSkeleton() {
  return (
    <ConsolePage width="wide">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </ConsolePage>
  );
}
