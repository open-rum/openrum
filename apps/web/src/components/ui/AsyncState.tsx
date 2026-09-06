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
}: {
  error: unknown;
  title: string;
  remediation: string;
  onRetry?: () => void;
}) {
  const requestId = error instanceof HTTPError ? error.requestId : "";
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span>{remediation}</span>
        {requestId ? <small className="mt-1 block font-mono">Request ID: {requestId}</small> : null}
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCwIcon /> 重新加载
          </Button>
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
