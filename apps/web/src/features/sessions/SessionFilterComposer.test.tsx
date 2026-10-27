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
    <>
      <SessionFilterComposer
        filters={filters}
        facets={facets}
        onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
      />
      <output aria-label="q">{filters.q ?? ""}</output>
    </>
  );
}

describe("session filter composer", () => {
  it("focuses and opens with / outside editable controls", async () => {
    render(<Harness />);
    const search = screen.getByRole("combobox", { name: "搜索会话" });

    fireEvent.keyDown(window, { key: "/" });

    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByText("添加条件")).toBeTruthy();
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
    expect(screen.queryByText("添加条件")).toBeNull();
  });

  it("writes a chosen field and value into the query text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "搜索会话" }) as HTMLInputElement;

    await user.click(box);
    await user.click(screen.getByRole("option", { name: /国家 \/ 地区/ }));
    expect(box.value).toBe("country:");
    await user.click(screen.getByRole("option", { name: /JP/ }));

    expect(box.value).toBe("country:JP");
    expect(screen.getByRole("status", { name: "q" }).textContent).toBe("country:JP");
  });

  it("offers the old quick signals as conditions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "搜索会话" }));
    await user.click(screen.getByRole("button", { name: "有错误" }));
    expect(screen.getByRole("status", { name: "q" }).textContent).toBe("errors:>0");
  });
});
