import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sourceMapFailureLabel } from "@/features/issues/sourceMapFailures";
import { testSourceMap, type Release } from "@/lib/api/releases";
import { ArtifactStatus } from "./ArtifactStatus";
import { expectedArtifactName } from "./releaseLinks";
import { describeUploadError } from "./uploadQueue";

export function MatchTester({ projectId, release }: { projectId: string; release?: Release }) {
  const [url, setURL] = useState("https://example.com/assets/app.js");
  const [line, setLine] = useState("1");
  const [column, setColumn] = useState("0");
  const match = useMutation({
    mutationFn: () =>
      testSourceMap(projectId, {
        release: release?.version ?? "",
        dist: release?.dist ?? "",
        stack: `at OpenRUMTest (${url}:${line}:${column})`,
      }),
  });
  const firstFrame = match.data?.frames[0];
  const original = match.data?.frames.find((item) => item.original)?.original;
  const failure =
    sourceMapFailureLabel(firstFrame?.failure) ?? sourceMapFailureLabel(match.data?.failure);
  return (
    <Card>
      <CardHeader>
        <CardTitle>匹配测试</CardTitle>
        <CardDescription>
          {release
            ? `用 ${release.version}${release.dist ? `（dist ${release.dist}）` : ""} 的 Source Map 还原一个生产位置。`
            : "先选择一个版本，再输入生产脚本位置。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="match-tester">
        <label>
          <span>脚本 URL</span>
          <Input value={url} onChange={(event) => setURL(event.target.value)} />
        </label>
        <div>
          <label>
            <span>行</span>
            <Input
              inputMode="numeric"
              value={line}
              onChange={(event) => setLine(event.target.value)}
            />
          </label>
          <label>
            <span>列</span>
            <Input
              inputMode="numeric"
              value={column}
              onChange={(event) => setColumn(event.target.value)}
            />
          </label>
        </div>
        <Button
          variant="outline"
          disabled={!release || match.isPending}
          onClick={() => match.mutate()}
        >
          <FlaskConicalIcon />
          {match.isPending ? "测试中…" : "测试匹配"}
        </Button>
        {match.data ? (
          <div className={`match-result is-${match.data.status}`}>
            <ArtifactStatus status={original ? "ready" : "failed"} />
            <strong>
              {original
                ? `${original.source}:${original.line}:${original.column}`
                : (failure ?? "没有匹配位置")}
            </strong>
          </div>
        ) : null}
        {match.data && !original && firstFrame?.failure === "missing_artifact" ? (
          <p className="match-tester__hint">
            期望的匹配名是脚本 URL 路径加 .map，例如{" "}
            <code>{expectedArtifactName(url) ?? "assets/app.js.map"}</code>。
          </p>
        ) : null}
        {match.error ? (
          <p className="release-form__error" role="alert">
            测试失败：{describeUploadError(match.error).message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
