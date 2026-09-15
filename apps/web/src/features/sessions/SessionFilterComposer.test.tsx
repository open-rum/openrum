// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionFilters, SessionsResponse } from "@/lib/api/sessions";
import { SessionFilterComposer } from "./SessionFilterComposer";

const initialFilters: SessionFilters = {
  projectId: "11111111-1111-4111-8111-111111111111",
  from: new Date("2026-09-12T00:00:00.000Z"),
  to: new Date("2026-09-13T00:00:00.000Z"),
  signal: "all",
  sort: "latest",
  page: 1,
};

const facets: SessionsResponse["facets"] = {
  environments: [],
  releases: [{ value: "web@0.1.0", sessions: 12 }],
  browsers: [{ value: "Chrome", sessions: 10 }],
  deviceTypes: [{ value: "mobile", sessions: 8 }],
  countries: [{ value: "JP", sessions: 6 }],
};

afterEach(cleanup);

function Harness() {
  const [filters, setFilters] = useState(initialFilters);
  return (
    <SessionFilterComposer
      filters={filters}
      facets={facets}
      onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
    />
  );
}

describe("session filter composer", () => {
  it("focuses and opens with / outside editable controls", async () => {
    render(<Harness />);
    const search = screen.getByRole("textbox", { name: "搜索会话或添加筛选条件" });

    fireEvent.keyDown(window, { key: "/" });

    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByText("添加筛选条件")).toBeTruthy();
  });

  it("does not steal focus when / is typed in another input", () => {
    render(
      <>
        <input aria-label="另一个输入框" />
        <Harness />
      </>,
    );
    const otherInput = screen.getByRole("textbox", { name: "另一个输入框" });
    otherInput.focus();

    fireEvent.keyDown(otherInput, { key: "/" });

    expect(document.activeElement).toBe(otherInput);
    expect(screen.queryByText("添加筛选条件")).toBeNull();
  });

  it("adds a structured filter token and lets the user remove it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("textbox", { name: "搜索会话或添加筛选条件" }));
    await user.click(screen.getByRole("button", { name: /国家 \/ 地区/ }));
    await user.click(screen.getByRole("button", { name: /JP/ }));

    expect(screen.getByText("国家：JP")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "移除筛选：国家：JP" }));
    expect(screen.queryByText("国家：JP")).toBeNull();
  });
});
