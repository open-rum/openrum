// Adapted from the supplied React Bits StrokeText: SVG dash drawing, then fill.
// The hidden HTML layer only reserves space; it is never painted over the animation.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import "./StrokeText.css";

function stableGlyphRandom(character, index) {
  let hash = 2166136261 ^ index;
  for (const codePoint of character) {
    hash ^= codePoint.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= index + 0x9e3779b9;
  hash = Math.imul(hash, 16777619);
  return (hash >>> 0) / 4294967295;
}

export default function StrokeText({
  text = "Draw Attention",
  strokeColor = "currentColor",
  fillColor = "currentColor",
  strokeWidth = 1.4,
  drawDuration = 1.6,
  durationVariance = 0.42,
  fillDelay = 0,
  launchWindow = 0.25,
  ease = "power2.out",
  trigger = "mount",
  fillMode = "wipe",
  fontSize = undefined,
  fontWeight = undefined,
  letterSpacing = undefined,
  reverse = false,
  className = "",
  style = {},
}) {
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const baselineRef = useRef(null);
  const wipeRef = useRef(null);
  const [metrics, setMetrics] = useState(null);
  const wipeId = `stroke-text-wipe-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const characters = Array.from(String(text ?? ""));
  const ready = metrics !== null;

  useLayoutEffect(() => {
    let disposed = false;
    let observer;
    const measure = () => {
      if (disposed || !rootRef.current || !measureRef.current) return;
      const root = rootRef.current;
      const box = root.getBoundingClientRect();
      const glyphs = measureRef.current.getBoundingClientRect();
      const font = getComputedStyle(root);
      const next = {
        width: glyphs.width,
        height: box.height,
        baseline: baselineRef.current.getBoundingClientRect().top - box.top,
        fontSize: font.fontSize,
        fontWeight: font.fontWeight,
        letterSpacing: font.letterSpacing,
        fontFamily: font.fontFamily,
      };
      if (!next.width || !next.height) return;
      setMetrics((previous) =>
        previous && Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next,
      );
    };
    // The text layout already requests its fonts. Do not animate a fallback font,
    // remeasure with a different font, and replay with a differently sized viewBox.
    document.fonts.ready.then(() => {
      if (disposed) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(rootRef.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [text, fontSize, fontWeight, letterSpacing]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!ready || !root) return undefined;
    const strokes = root.querySelectorAll("[data-stroke-char]");
    const fills = root.querySelectorAll("[data-fill-char]");
    const wipe = wipeRef.current;
    const dash = Math.max(parseFloat(getComputedStyle(root).fontSize) * 7, 200);
    const media = gsap.matchMedia();
    media.add(
      {
        reduce: "(prefers-reduced-motion: reduce)",
        animate: "(prefers-reduced-motion: no-preference)",
      },
      (context) => {
        const complete = () => {
          gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: 0 });
          gsap.set(fills, { opacity: fillMode === "none" ? 0 : 1 });
          if (wipe) gsap.set(wipe, { attr: { width: 1 } });
        };
        const reset = () => {
          gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
          gsap.set(fills, { opacity: fillMode === "wipe" ? 1 : 0 });
          if (wipe) gsap.set(wipe, { attr: { width: 0 } });
        };
        if (context.conditions.reduce) {
          complete();
          root.dataset.ready = "true";
          return () => {
            delete root.dataset.ready;
          };
        }
        reset();
        const timeline = gsap.timeline({
          paused: true,
          repeat: trigger === "loop" ? -1 : 0,
          repeatDelay: 0.9,
        });
        // Keep long Latin headlines feeling as simultaneous as short CJK copy:
        // every visible glyph begins within one fixed launch window. Whitespace
        // is excluded from the animated NodeList, so it never consumes a delay.
        const startStagger = strokes.length > 1 ? launchWindow / (strokes.length - 1) : 0;
        const ordering = { each: startStagger, from: reverse ? "end" : "start" };
        const variance = Math.min(Math.max(durationVariance, 0), 0.8);
        const strokeDurations = Array.from(strokes, (stroke, index) => {
          const random = stableGlyphRandom(stroke.textContent ?? "", index);
          const duration = drawDuration * (1 - variance * random);
          stroke.dataset.drawDuration = duration.toFixed(3);
          return duration;
        });
        timeline.to(
          strokes,
          {
            strokeDashoffset: 0,
            duration: (_, stroke) => Number(stroke.dataset.drawDuration),
            ease,
            stagger: ordering,
          },
          0,
        );
        const latestStrokeEnd = strokeDurations.reduce((latest, duration, index) => {
          const order = reverse ? strokes.length - 1 - index : index;
          return Math.max(latest, duration + order * startStagger);
        }, 0);
        // Join the phases at the exact end of the slowest outline. The optional
        // delay remains available for other uses, but the headline adds none.
        const fillAt = latestStrokeEnd + fillDelay;
        root.dataset.fillStart = fillAt.toFixed(3);
        if (fillMode === "wipe" && wipe) {
          timeline.to(
            wipe,
            {
              attr: { width: 1 },
              duration: Math.max(0.4, drawDuration * 0.5),
              ease: "power2.inOut",
            },
            fillAt,
          );
        } else if (fillMode === "fade") {
          timeline.to(
            fills,
            { opacity: 1, duration: Math.max(0.4, drawDuration * 0.5), ease, stagger: ordering },
            fillAt,
          );
        }
        let observer;
        const play = () => {
          reset();
          timeline.restart();
        };
        if (trigger === "hover") {
          complete();
          root.addEventListener("pointerenter", play);
        } else if (trigger === "scroll") {
          observer = new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                play();
                observer.disconnect();
              }
            },
            { rootMargin: "0px 0px -18% 0px" },
          );
          observer.observe(root);
        } else {
          play();
        }
        // Reveal only after initial stroke offsets and clipped fill are set,
        // in a layout effect before the browser paints.
        root.dataset.ready = "true";
        return () => {
          delete root.dataset.ready;
          delete root.dataset.fillStart;
          observer?.disconnect();
          root.removeEventListener("pointerenter", play);
          timeline.kill();
        };
      },
    );
    return () => media.revert();
  }, [
    ready,
    text,
    drawDuration,
    durationVariance,
    fillDelay,
    launchWindow,
    ease,
    trigger,
    fillMode,
    reverse,
  ]);

  const glyphStyle = metrics
    ? {
        fontSize: metrics.fontSize,
        fontWeight: metrics.fontWeight,
        letterSpacing: metrics.letterSpacing,
        fontFamily: metrics.fontFamily,
      }
    : undefined;

  return (
    <span
      ref={rootRef}
      className={`stroke-text ${className}`.trim()}
      style={{
        fontSize,
        fontWeight,
        letterSpacing,
        ...style,
        "--stroke-text-color": strokeColor,
        "--stroke-text-fill": fillColor,
        "--stroke-text-width": `${strokeWidth / 128}em`,
      }}
      data-launch-window={launchWindow}
      role="img"
      aria-label={String(text ?? "")}
    >
      <span className="stroke-text__layout" aria-hidden="true">
        <span ref={measureRef}>{text}</span>
        <span ref={baselineRef} className="stroke-text__baseline" />
      </span>
      <svg
        className="stroke-text__svg"
        aria-hidden="true"
        viewBox={metrics ? `0 0 ${metrics.width} ${metrics.height}` : "0 0 1 1"}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={wipeId} clipPathUnits="objectBoundingBox">
            <rect ref={wipeRef} x="0" y="0" width="0" height="1" />
          </clipPath>
        </defs>
        <text
          className="stroke-text__stroke"
          x="0"
          y={metrics?.baseline ?? 0}
          fill="none"
          stroke={strokeColor}
          strokeWidth={metrics ? (parseFloat(metrics.fontSize) * strokeWidth) / 128 : 0}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={glyphStyle}
        >
          {characters.map((char, index) => (
            <tspan data-stroke-char={char.trim() ? "" : undefined} key={index}>
              {char}
            </tspan>
          ))}
        </text>
        <text
          className="stroke-text__fill"
          x="0"
          y={metrics?.baseline ?? 0}
          fill={fillColor}
          stroke="none"
          style={glyphStyle}
          clipPath={fillMode === "wipe" ? `url(#${wipeId})` : undefined}
        >
          {characters.map((char, index) => (
            <tspan data-fill-char={char.trim() ? "" : undefined} key={index}>
              {char}
            </tspan>
          ))}
        </text>
      </svg>
      <noscript
        dangerouslySetInnerHTML={{
          __html: "<style>.stroke-text__layout{visibility:visible}</style>",
        }}
      />
    </span>
  );
}
