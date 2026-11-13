// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFilters } from "./useFilters";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";

describe("useFilters", () => {
  it("preserves the exact query across a shared URL reload", () => {
    window.history.replaceState(
      {},
      "",
      "/?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&environment=production",
    );
    const first = renderHook(() => useFilters(projectId));
    act(() => first.result.current.updateFilters({ release: "web-42", route: "/checkout" }));
    const sharedURL = window.location.href;
    const expected = first.result.current.filters;
    first.unmount();

    window.history.replaceState({}, "", sharedURL);
    const reloaded = renderHook(() => useFilters(projectId));
    expect(reloaded.result.current.filters).toEqual(expected);
    expect(window.location.href).toBe(sharedURL);
    reloaded.unmount();
  });

  it("keeps the relative time preset the analysis bar wrote to the URL", () => {
    window.history.replaceState(
      {},
      "",
      "/?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&timePreset=24h",
    );
    const hook = renderHook(() => useFilters(projectId));
    expect(new URL(window.location.href).searchParams.get("timePreset")).toBe("24h");

    act(() => hook.result.current.updateFilters({ release: "web-42" }));
    expect(new URL(window.location.href).searchParams.get("timePreset")).toBe("24h");
    hook.unmount();
  });

  it("drops the preset when this hook changes the range itself", () => {
    window.history.replaceState(
      {},
      "",
      "/?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&timePreset=24h",
    );
    const hook = renderHook(() => useFilters(projectId));
    act(() =>
      hook.result.current.updateFilters({
        from: new Date("2026-09-03T00:00:00.000Z"),
        to: new Date("2026-09-04T00:00:00.000Z"),
      }),
    );
    expect(new URL(window.location.href).searchParams.has("timePreset")).toBe(false);
    hook.unmount();
  });
});
