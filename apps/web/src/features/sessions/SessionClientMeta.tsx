import SiArc from "@icons-pack/react-simple-icons/icons/SiArc";
import SiBrave from "@icons-pack/react-simple-icons/icons/SiBrave";
import SiDuckduckgo from "@icons-pack/react-simple-icons/icons/SiDuckduckgo";
import SiFirefoxbrowser from "@icons-pack/react-simple-icons/icons/SiFirefoxbrowser";
import SiOpera from "@icons-pack/react-simple-icons/icons/SiOpera";
import SiSamsung from "@icons-pack/react-simple-icons/icons/SiSamsung";
import SiVivaldi from "@icons-pack/react-simple-icons/icons/SiVivaldi";
import { AppWindowIcon, CpuIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SessionClientMeta({
  country,
  deviceType,
  browser,
  os,
  className,
}: {
  country?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  className?: string;
}) {
  if (!country && !deviceType && !browser && !os) {
    return <span className={cn("text-muted-foreground", className)}>未知设备</span>;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <span
        className={cn("inline-flex flex-wrap items-center gap-2.5", className)}
        aria-label={[country, deviceType, browser, os].filter(Boolean).join("，")}
      >
        {country ? (
          <MetaTooltip label={`国家或地区：${country.toUpperCase()}`}>
            <span className="text-base leading-none" aria-hidden="true">
              {countryFlag(country)}
            </span>
          </MetaTooltip>
        ) : null}
        {deviceType ? (
          <MetaTooltip label={`设备：${deviceLabel(deviceType)}`}>
            <DeviceTypeIcon deviceType={deviceType} />
          </MetaTooltip>
        ) : null}
        {browser ? (
          <MetaTooltip label={`浏览器：${browser}`}>
            <BrowserBrandIcon browser={browser} />
          </MetaTooltip>
        ) : null}
        {os ? (
          <MetaTooltip label={`操作系统：${os}`}>
            <CpuIcon className="size-4" aria-hidden="true" />
          </MetaTooltip>
        ) : null}
      </span>
    </TooltipProvider>
  );
}

function MetaTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex text-muted-foreground">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DeviceTypeIcon({ deviceType }: { deviceType: string }) {
  const normalized = deviceType.toLowerCase();
  if (normalized === "mobile" || normalized === "phone") {
    return <SmartphoneIcon className="size-4" aria-hidden="true" />;
  }
  if (normalized === "tablet") {
    return <TabletIcon className="size-4" aria-hidden="true" />;
  }
  return <MonitorIcon className="size-4" aria-hidden="true" />;
}

function BrowserBrandIcon({ browser }: { browser: string }) {
  const normalized = browser.toLowerCase();
  const properties = { className: "size-4", color: "default", "aria-hidden": true } as const;
  if (normalized.includes("chrome") || normalized.includes("chromium")) {
    return <DeviconBrowserIcon name="chrome" />;
  }
  if (normalized.includes("safari")) return <DeviconBrowserIcon name="safari" />;
  if (normalized.includes("firefox")) return <SiFirefoxbrowser {...properties} />;
  if (normalized.includes("opera")) return <SiOpera {...properties} />;
  if (normalized.includes("brave")) return <SiBrave {...properties} />;
  if (normalized.includes("samsung")) return <SiSamsung {...properties} />;
  if (normalized.includes("vivaldi")) return <SiVivaldi {...properties} />;
  if (normalized === "arc" || normalized.includes("arc browser")) {
    return <SiArc {...properties} />;
  }
  if (normalized.includes("duckduckgo")) return <SiDuckduckgo {...properties} />;
  return <AppWindowIcon className="size-4" aria-hidden="true" />;
}

function DeviconBrowserIcon({ name }: { name: "chrome" | "safari" }) {
  return (
    <img
      src={`/icons/devicon-${name}.svg`}
      alt=""
      className="size-4 shrink-0"
      aria-hidden="true"
      draggable={false}
      data-icon-source={`devicon:${name}`}
    />
  );
}

function deviceLabel(deviceType: string) {
  const normalized = deviceType.toLowerCase();
  if (normalized === "desktop") return "桌面端";
  if (normalized === "mobile" || normalized === "phone") return "移动端";
  if (normalized === "tablet") return "平板";
  return deviceType;
}

function countryFlag(country: string) {
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}
