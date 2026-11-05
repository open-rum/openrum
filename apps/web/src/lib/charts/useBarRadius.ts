import { useMemo, useSyncExternalStore } from "react";
import { BAR_RADIUS_TOP } from "@/components/ui/chart";

type BarRadius = [number, number, number, number];

/** The column cap never grows past the Console's 6px, so round themes keep slim bars. */
const MAX_TOP_RADIUS = BAR_RADIUS_TOP[0];

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function currentTheme() {
  return document.documentElement.dataset.theme ?? "";
}

/** daisyUI's `--radius-selector` in pixels; unknown when the theme does not set it. */
function selectorRadius(): number | undefined {
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue("--radius-selector").trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return undefined;
  if (value.endsWith("rem"))
    return amount * (Number.parseFloat(getComputedStyle(root).fontSize) || 16);
  return amount;
}

/**
 * Rounded tops for column charts that follow the daisyUI theme: square themes get square
 * columns, and every other theme keeps the 6px cap. Recharts takes the radius as a number,
 * so it is read from the theme's `--radius-selector` whenever `<html data-theme>` changes.
 */
export function useBarRadiusTop(): BarRadius {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "");
  return useMemo(() => {
    void theme;
    const radius = Math.min(MAX_TOP_RADIUS, selectorRadius() ?? MAX_TOP_RADIUS);
    return [radius, radius, 0, 0];
  }, [theme]);
}
