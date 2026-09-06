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
});
