import { cn } from "@/lib/utils";

/** Decorative product sketch; all colors follow the selected Console theme. */
export function ProjectConnectionIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 280 160"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("h-auto w-60 max-w-full text-base-content", className)}
    >
      <ellipse cx="140" cy="144" rx="110" ry="10" className="fill-base-content/5" />
      <path
        d="M36 72V118Q36 126 44 126H226Q238 126 238 114V82"
        stroke="currentColor"
        strokeOpacity=".16"
        strokeDasharray="3 5"
      />
      <g transform="rotate(-8 51 66)">
        <rect x="10" y="30" width="82" height="72" rx="8" className="fill-base-100" />
        <rect
          x="10"
          y="30"
          width="82"
          height="72"
          rx="8"
          stroke="currentColor"
          strokeOpacity=".2"
        />
        <path d="M10 48H92" stroke="currentColor" strokeOpacity=".12" />
        <path
          d="M21 39H23M29 39H31M37 39H39"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeLinecap="round"
        />
        <path
          d="m35 63-9 9 9 9m30-18 9 9-9 9m-11-22-8 26"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <rect x="73" y="17" width="144" height="108" rx="10" className="fill-base-100" />
      <rect
        x="73"
        y="17"
        width="144"
        height="108"
        rx="10"
        stroke="currentColor"
        strokeOpacity=".24"
      />
      <path d="M73 40H217" stroke="currentColor" strokeOpacity=".12" />
      <rect x="85" y="26" width="7" height="7" rx="2" className="fill-primary/70" />
      <path
        d="M99 29.5H135"
        stroke="currentColor"
        strokeOpacity=".25"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M90 61H200M90 81H200M90 101H200" stroke="currentColor" strokeOpacity=".07" />
      <path
        d="m90 95 17-7 15 4 17-27 16 10 19-20 14 11 12-5"
        className="stroke-primary/65"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="174" cy="55" r="4" className="fill-primary" />
      <circle cx="174" cy="55" r="8" className="stroke-primary/20" strokeWidth="4" />
      <g transform="rotate(7 234 102)">
        <rect x="196" y="76" width="74" height="56" rx="8" className="fill-base-100" />
        <rect
          x="196"
          y="76"
          width="74"
          height="56"
          rx="8"
          stroke="currentColor"
          strokeOpacity=".2"
        />
        <path
          d="m207 90 3 3 5-6"
          className="stroke-primary/70"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M222 90H258M208 105H249M208 116H237"
          stroke="currentColor"
          strokeOpacity=".22"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M239 30v8m-4-4h8M50 13v6m-3-3h6"
        stroke="currentColor"
        strokeOpacity=".2"
        strokeLinecap="round"
      />
      <circle cx="15" cy="119" r="2" className="fill-primary/40" />
    </svg>
  );
}
