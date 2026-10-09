// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "./sonner";

beforeAll(() => {
  // jsdom has no matchMedia; the theme and Sonner both read it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("Toaster", () => {
  it("shows toasts raised anywhere at the top of the page", async () => {
    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );
    act(() => {
      toast.success("已删除项目「商城」", { description: "数据会在后台删除。" });
    });
    expect(await screen.findByText("已删除项目「商城」")).toBeTruthy();
    expect(screen.getByText("数据会在后台删除。")).toBeTruthy();
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-y-position")).toBe(
      "top",
    );
  });
});
