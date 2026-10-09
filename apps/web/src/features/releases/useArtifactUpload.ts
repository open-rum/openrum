import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { completeArtifact, presignArtifact, putArtifactBytes, sha256Hex } from "@/lib/api/releases";
import {
  ACTIVE_STATUSES,
  UPLOAD_CONCURRENCY,
  planUploads,
  runWithConcurrency,
  summarizeUploads,
  uploadOne,
  type SelectedFile,
  type UploadDeps,
  type UploadItem,
} from "./uploadQueue";

export function useArtifactUpload(projectId: string, releaseId: string, maxBytes?: number) {
  const client = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const deps = useMemo<UploadDeps>(
    () => ({
      hash: sha256Hex,
      presign: (input) => presignArtifact(projectId, releaseId, input),
      put: putArtifactBytes,
      complete: (artifactId) => completeArtifact(projectId, releaseId, artifactId),
    }),
    [projectId, releaseId],
  );

  const patch = useCallback((id: string, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["artifacts", projectId, releaseId] });
    void client.invalidateQueries({ queryKey: ["releases", projectId] });
  }, [client, projectId, releaseId]);

  const start = useCallback(
    async (files: SelectedFile[], prefix: string) => {
      const planned = planUploads(files, prefix, maxBytes);
      setItems(planned);
      const runnable = planned.filter((item) => item.status === "waiting");
      if (!runnable.length) return;
      await runWithConcurrency(runnable, UPLOAD_CONCURRENCY, (item) =>
        uploadOne(item, deps, (change) => patch(item.id, change), { maxBytes }),
      );
      refresh();
    },
    [deps, maxBytes, patch, refresh],
  );

  const replace = useCallback(
    async (item: UploadItem) => {
      await uploadOne(item, deps, (change) => patch(item.id, change), {
        replace: true,
        maxBytes,
      });
      refresh();
    },
    [deps, maxBytes, patch, refresh],
  );

  const clear = useCallback(() => setItems([]), []);
  const busy = items.some((item) => ACTIVE_STATUSES.has(item.status));
  const summary = useMemo(() => summarizeUploads(items), [items]);
  return { items, start, replace, clear, busy, summary };
}
