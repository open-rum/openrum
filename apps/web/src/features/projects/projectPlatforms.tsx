import type { ComponentProps } from "react";
import SiAngular from "@icons-pack/react-simple-icons/icons/SiAngular";
import SiJavascript from "@icons-pack/react-simple-icons/icons/SiJavascript";
import SiNextdotjs from "@icons-pack/react-simple-icons/icons/SiNextdotjs";
import SiNuxt from "@icons-pack/react-simple-icons/icons/SiNuxt";
import SiReact from "@icons-pack/react-simple-icons/icons/SiReact";
import SiSvelte from "@icons-pack/react-simple-icons/icons/SiSvelte";
import SiVuedotjs from "@icons-pack/react-simple-icons/icons/SiVuedotjs";
import type { SDKPlatform } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

// Shared by the selector and project summaries; keeping the metadata beside
// the icon component prevents platform labels and icons from drifting.
// eslint-disable-next-line react-refresh/only-export-components
export const projectPlatforms = [
  { value: "javascript", label: "JavaScript", icon: SiJavascript, brandColor: true },
  { value: "react", label: "React", icon: SiReact, brandColor: true },
  { value: "vue", label: "Vue", icon: SiVuedotjs, brandColor: true },
  { value: "nextjs", label: "Next.js", icon: SiNextdotjs, brandColor: false },
  { value: "nuxt", label: "Nuxt", icon: SiNuxt, brandColor: true },
  { value: "angular", label: "Angular", icon: SiAngular, brandColor: false },
  { value: "svelte", label: "Svelte", icon: SiSvelte, brandColor: true },
] as const satisfies ReadonlyArray<{
  value: SDKPlatform;
  label: string;
  icon: typeof SiJavascript;
  /**
   * Draw in the brand's own colour from Simple Icons. Brands whose colour is black
   * (Next.js, Angular) keep the text colour so they stay visible in dark mode.
   */
  brandColor: boolean;
}>;

// eslint-disable-next-line react-refresh/only-export-components
export function getProjectPlatform(platform: SDKPlatform) {
  return projectPlatforms.find((item) => item.value === platform) ?? projectPlatforms[0];
}

export function ProjectPlatformIcon({
  platform,
  className,
  ...props
}: { platform: SDKPlatform } & Omit<ComponentProps<typeof SiJavascript>, "title">) {
  const definition = getProjectPlatform(platform);
  const Icon = definition.icon;
  return (
    <Icon
      aria-label={definition.label}
      role="img"
      color={definition.brandColor ? "default" : "currentColor"}
      className={cn("size-5 shrink-0", className)}
      {...props}
    />
  );
}
