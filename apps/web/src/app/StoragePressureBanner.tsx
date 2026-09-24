import { GaugeIcon, HardDriveIcon, OctagonAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StoragePressure } from "@/lib/api/storagePressure";

export function StoragePressureBanner({
  pressure,
  canRecover = false,
}: {
  pressure?: StoragePressure;
  canRecover?: boolean;
}) {
  if (!pressure || pressure.mode === "normal" || pressure.mode === "unknown") return null;

  const used =
    pressure.usedPercent === null ? "容量未知" : `已用 ${pressure.usedPercent.toFixed(1)}%`;
  if (pressure.mode === "blocked") {
    return (
      <Alert variant="destructive" className="storage-pressure-banner">
        <OctagonAlertIcon aria-hidden="true" />
        <AlertTitle>存储空间严重不足，数据接入已暂停</AlertTitle>
        <AlertDescription>
          ClickHouse {used}。Ingest 正在安全丢弃新上报，空间降回 90% 以下后自动恢复。
        </AlertDescription>
        {canRecover ? (
          <AlertAction>
            <Button variant="destructive" size="sm" asChild>
              <a href="/settings/instance/retention?recovery=1#emergency-storage-recovery">
                立即清理旧数据
              </a>
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    );
  }
  if (pressure.mode === "sampling") {
    return (
      <Alert variant="warning" className="storage-pressure-banner">
        <GaugeIcon aria-hidden="true" />
        <AlertTitle>存储空间不足，已自动降低采样率</AlertTitle>
        <AlertDescription>
          ClickHouse {used}。Browser SDK 临时采样上限为
          {` ${Math.round((pressure.automaticSamplingRate ?? 0) * 100)}%`}；达到 95%
          将暂停数据接入。
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="warning" className="storage-pressure-banner">
      <HardDriveIcon aria-hidden="true" />
      <AlertTitle>ClickHouse 存储空间偏低</AlertTitle>
      <AlertDescription>{used}，达到 90% 后将自动降低 Browser SDK 采样率。</AlertDescription>
    </Alert>
  );
}
