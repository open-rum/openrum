import type { ReactNode } from "react";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { HTTPError } from "@/lib/auth/session";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

export function AsyncError({
  error,
  title,
  remediation,
  onRetry,
  action,
}: {
  error: unknown;
  title: string;
  remediation: string;
  onRetry?: () => void;
  /** A way out that fits this failure better than retrying, shown before 重新加载. */
  action?: ReactNode;
}) {
  const requestId = error instanceof HTTPError ? error.requestId : "";
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span>{remediation}</span>
        {requestId ? <small className="mt-1 block font-mono">Request ID: {requestId}</small> : null}
        {action || onRetry ? (
          <span className="mt-3 flex flex-wrap gap-2">
            {action}
            {onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RefreshCwIcon /> 重新加载
              </Button>
            ) : null}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function AsyncLoading({
  label = "正在加载数据",
  children,
}: {
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3" aria-label={label} aria-busy="true">
      {children ?? (
        <>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-52 w-full" />
        </>
      )}
    </div>
  );
}
