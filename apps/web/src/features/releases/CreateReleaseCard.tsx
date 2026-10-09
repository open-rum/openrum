import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ReleaseInput = { version: string; dist: string; commitSha: string };

/**
 * Registering a release is idempotent: the parent selects the existing release when the same
 * version and dist were registered before. Remount with a new `key` to apply a new prefill.
 */
export function CreateReleaseCard({
  initialVersion = "",
  initialDist = "",
  hint,
  notice,
  pending,
  error,
  onCreate,
}: {
  initialVersion?: string;
  initialDist?: string;
  hint?: string;
  notice?: string;
  pending: boolean;
  error?: string;
  onCreate: (input: ReleaseInput) => Promise<unknown> | void;
}) {
  const [version, setVersion] = useState(initialVersion);
  const [dist, setDist] = useState(initialDist);
  const [commitSha, setCommitSha] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>登记版本</CardTitle>
        <CardDescription>
          release 与 dist 必须和 SDK 上报的完全一致；重复登记会直接选中已有版本。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hint ? <p className="release-form__hint">{hint}</p> : null}
        <form
          className="release-form"
          onSubmit={(event) => {
            event.preventDefault();
            const input = {
              version: version.trim(),
              dist: dist.trim(),
              commitSha: commitSha.trim(),
            };
            if (!input.version) return;
            void Promise.resolve(onCreate(input)).then(
              () => setCommitSha(""),
              () => undefined,
            );
          }}
        >
          <label>
            <span>Release *</span>
            <Input
              required
              name="version"
              maxLength={128}
              placeholder="web@2026.09.03"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            />
          </label>
          <label>
            <span>Dist</span>
            <Input
              name="dist"
              maxLength={64}
              placeholder="留空表示默认"
              value={dist}
              onChange={(event) => setDist(event.target.value)}
            />
          </label>
          <label>
            <span>Commit SHA</span>
            <Input
              name="commitSha"
              maxLength={64}
              placeholder="a1b2c3d"
              value={commitSha}
              onChange={(event) => setCommitSha(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={pending || !version.trim()}>
            <PlusIcon />
            {pending ? "登记中…" : "登记"}
          </Button>
        </form>
        {notice && !error ? (
          <p className="release-form__notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="release-form__error" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
