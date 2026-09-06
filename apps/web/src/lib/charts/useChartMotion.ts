import { useEffect, useState } from "react";

const query = "(prefers-reduced-motion: reduce)";

/**
 * Recharts runs its transitions in JavaScript, so the global
 * prefers-reduced-motion stylesheet rule cannot reach them. Charts ask here
 * instead and pass the answer to isAnimationActive.
 */
export function useChartMotion(): boolean {
  const [animate, setAnimate] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const handleChange = () => setAnimate(!media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return animate;
}

function prefersReducedMotion() {
  // Guarded because the test environment does not always provide matchMedia.
  return typeof window !== "undefined" && (window.matchMedia?.(query).matches ?? false);
}
