// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBarRadiusTop } from "./useBarRadius";

const root = document.documentElement;

function theme(name: string, selector: string) {
  root.style.setProperty("--radius-selector", selector);
  root.dataset.theme = name;
}

describe("useBarRadiusTop", () => {
  afterEach(() => {
    root.style.removeProperty("--radius-selector");
    delete root.dataset.theme;
  });

  it("squares the columns for a square theme and caps round themes at 6px", async () => {
    theme("cupcake", "1rem");
    const { result } = renderHook(() => useBarRadiusTop());
    expect(result.current).toEqual([6, 6, 0, 0]);

    await act(async () => theme("lofi", "0rem"));
    expect(result.current).toEqual([0, 0, 0, 0]);

    await act(async () => theme("corporate", "0.25rem"));
    expect(result.current).toEqual([4, 4, 0, 0]);
  });

  it("keeps the 6px cap when the theme sets no radius", () => {
    const { result } = renderHook(() => useBarRadiusTop());
    expect(result.current).toEqual([6, 6, 0, 0]);
  });
});
