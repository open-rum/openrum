import { useEffect, useRef, useState } from "react";
import LetterGlitch from "./LetterGlitch";

/** Resolve the site's palette tokens before passing colours to the WebGL canvas. */
export default function MakeItBetterBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<{ base: string; accent: string } | null>(null);

  useEffect(() => {
    const syncPalette = () => {
      if (!ref.current) return;
      const styles = getComputedStyle(ref.current);
      const base = styles.getPropertyValue("--lp-fg").trim();
      const accent = styles.getPropertyValue("--lp-accent").trim();
      if (base && accent) setPalette({ base, accent });
    };
    syncPalette();
    const observer = new MutationObserver(syncPalette);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-palette", "data-landing-palette", "data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="lp-make-glitch" aria-hidden="true">
      {palette ? (
        <LetterGlitch
          baseColor={palette.base}
          glitchColors={[palette.base, palette.accent]}
          fontSize={14}
          spacing={0.7}
          density={0.8}
          baseOpacity={0.16}
          glitchAmount={0.3}
          speed={0.65}
          flow={0.45}
          edgeFade={0.12}
          centerFade={0.8}
          cursorRadius={120}
          clickEffect="tear"
          intro={false}
        />
      ) : null}
    </div>
  );
}
