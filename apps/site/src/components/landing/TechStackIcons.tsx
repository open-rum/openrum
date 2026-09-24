import type { CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type TechStackItem = { name: string; icon: string; href: string };

export default function TechStackIcons({
  items,
  label,
}: {
  items: TechStackItem[];
  label: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <ul className="lp-tech-dock" aria-label={label}>
        {items.map(({ name, icon, href }, index) => (
          <li key={name} style={{ "--lp-order": index } as CSSProperties}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* SVG markup comes only from repository-owned build-time assets. */}
                <a
                  href={href}
                  className="lp-tech-link"
                  aria-label={name}
                  dangerouslySetInnerHTML={{ __html: icon }}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {name}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
