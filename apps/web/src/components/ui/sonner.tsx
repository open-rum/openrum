import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme/ThemeProvider";

// shadcn's Sonner wrapper, reading the Console theme instead of next-themes. Toasts
// open at the top centre and take their colours from design tokens. Raise them with
// `toast()` / `toast.success()` / `toast.error()` imported from "sonner".
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="top-center"
      offset={16}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-[var(--ds-success)]" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-[var(--ds-warning)]" />,
        error: <CircleAlertIcon className="size-4 text-[var(--ds-danger)]" />,
        loading: <LoaderCircleIcon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !shadow-lg",
          description: "!text-muted-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
