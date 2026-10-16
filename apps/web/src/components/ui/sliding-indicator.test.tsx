// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

afterEach(cleanup);

describe("sliding indicator", () => {
  // A child's layout effect runs before its parent's ref is attached. React's StrictMode
  // re-runs effects in development and hides that, so this renders without it, like production.
  it("is rendered on the first pass of a segmented toggle group", () => {
    render(
      <ToggleGroup type="single" variant="outline" value="b" aria-label="指标">
        <ToggleGroupItem value="a">事件</ToggleGroupItem>
        <ToggleGroupItem value="b">会话</ToggleGroupItem>
      </ToggleGroup>,
    );
    const indicator = screen
      .getByRole("radiogroup")
      .querySelector('[data-slot="sliding-indicator"]');
    expect(indicator).toBeTruthy();
    expect(indicator?.classList.contains("hidden")).toBe(false);
  });

  it("is rendered on the first pass of pill tabs", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">一</TabsTrigger>
          <TabsTrigger value="b">二</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const indicator = screen.getByRole("tablist").querySelector('[data-slot="sliding-indicator"]');
    expect(indicator).toBeTruthy();
    expect(indicator?.classList.contains("hidden")).toBe(false);
  });

  it("stays in the group when the selection changes", async () => {
    const user = userEvent.setup();
    render(
      <ToggleGroup type="single" variant="outline" defaultValue="a" aria-label="指标">
        <ToggleGroupItem value="a">事件</ToggleGroupItem>
        <ToggleGroupItem value="b">会话</ToggleGroupItem>
      </ToggleGroup>,
    );
    await user.click(screen.getByRole("radio", { name: "会话" }));
    const group = screen.getByRole("radiogroup");
    expect(group.querySelectorAll('[data-slot="sliding-indicator"]')).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "会话" }).getAttribute("data-state")).toBe("on");
  });
});
