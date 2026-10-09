import {
  brandMarkViewBox,
  signalScoutTorsoPath,
  signalScoutArmPath,
  signalScoutEyePath,
  signalScoutNearSignalPath,
  signalScoutFarSignalPath,
} from "@openrum/design-tokens/brand";
import "@openrum/design-tokens/brand.css";
import { useId } from "react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "size-5 [&_svg]:size-5",
  lockup: "size-(--brand-lockup-mark-size) [&_svg]:size-full",
  md: "size-10 [&_svg]:size-10",
} as const;

export function BrandMark({
  size = "sm",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  // Eyes are cut out of the body so the background shows through. The eye shapes live
  // in the mask, so the blink (which fades them) closes the holes for a moment.
  const maskId = `signal-scout-eyes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span
      aria-hidden="true"
      data-slot="brand-mark"
      className={cn("grid shrink-0 place-items-center text-(--ds-logo)", sizes[size], className)}
    >
      <svg
        className="signal-scout"
        viewBox={brandMarkViewBox}
        fill="currentColor"
        shapeRendering="crispEdges"
        focusable="false"
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="2" y="1" width="20" height="20">
            <rect x="2" y="1" width="20" height="20" fill="white" />
            <path className="signal-scout__eyes" d={signalScoutEyePath} fill="black" />
          </mask>
        </defs>
        <g className="signal-scout__body" mask={`url(#${maskId})`}>
          <path d={signalScoutTorsoPath} />
          <path className="signal-scout__arm" d={signalScoutArmPath} />
          <path className="signal-scout__signal" d={signalScoutNearSignalPath} />
          <path
            className="signal-scout__signal signal-scout__signal--far"
            d={signalScoutFarSignalPath}
          />
        </g>
      </svg>
    </span>
  );
}
