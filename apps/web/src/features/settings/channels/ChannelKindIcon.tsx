import { MailIcon, WebhookIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const tiles: Record<string, { glyph: string; className: string }> = {
  feishu: { glyph: "飞", className: "bg-[var(--ds-channel-feishu)]" },
  dingtalk: { glyph: "钉", className: "bg-[var(--ds-channel-dingtalk)]" },
  wecom: { glyph: "企", className: "bg-[var(--ds-channel-wecom)]" },
  slack: { glyph: "S", className: "bg-[var(--ds-channel-slack)]" },
};

/**
 * A small identity tile for a channel kind. Brand services use a lettermark on their
 * signature colour rather than a copied logo; generic kinds use an icon.
 */
export function ChannelKindIcon({
  kind,
  size = "md",
  className,
}: {
  kind: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "size-5 rounded text-[11px]" : "size-8 rounded-md text-sm";
  const tile = tiles[kind];
  if (tile)
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-semibold text-[var(--ds-channel-foreground)]",
          box,
          tile.className,
          className,
        )}
      >
        {tile.glyph}
      </span>
    );
  const Icon = kind === "email" || kind === "smtp" ? MailIcon : WebhookIcon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border bg-muted text-muted-foreground",
        box,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-4"} />
    </span>
  );
}
