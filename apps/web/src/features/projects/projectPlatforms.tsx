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
  { value: "javascript", label: "JavaScript", icon: SiJavascript },
  { value: "react", label: "React", icon: SiReact },
  { value: "vue", label: "Vue", icon: SiVuedotjs },
  { value: "nextjs", label: "Next.js", icon: SiNextdotjs },
  { value: "nuxt", label: "Nuxt", icon: SiNuxt },
  { value: "angular", label: "Angular", icon: SiAngular },
  { value: "svelte", label: "Svelte", icon: SiSvelte },
] as const satisfies ReadonlyArray<{
  value: SDKPlatform;
  label: string;
  icon: typeof SiJavascript;
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
      className={cn("size-5 shrink-0", className)}
      {...props}
    />
  );
}
