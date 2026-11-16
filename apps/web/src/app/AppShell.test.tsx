// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("@tanstack/react-router", () => ({
  Outlet: function PageDraft() {
    const [draft, setDraft] = useState("");
    return (
      <input
        aria-label="规则草稿"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));
afterEach(cleanup);
describe("project page isolation", () => {
  it("preserves an in-progress draft during ordinary renders and resets it when switching projects", () => {
    const page = (id: string) => <AppShell contentKey={id} navigation={null} statusBar={null} />;
    const view = render(page("p1"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "first project's rule" } });
    view.rerender(page("p1"));
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("first project's rule");
    view.rerender(page("p2"));
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("");
  });
});
