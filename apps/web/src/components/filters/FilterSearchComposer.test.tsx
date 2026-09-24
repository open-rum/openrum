// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { BehaviorFilters } from "@/lib/api/analytics";
import type { APIFilters } from "@/lib/api/apis";
import type { LogFilters } from "@/lib/api/logs";
import { ApiFilterBar } from "@/features/apis/ApiFilters";
import { EventFilterComposer } from "@/features/events/EventFilterComposer";
import { LogFilterComposer } from "@/features/logs/LogFilterComposer";
import { splitTerms } from "@/features/logs/logFilterQuery";

afterEach(cleanup);

describe("shared filter search consumers", () => {
  it("turns an event selection into a removable token", async () => {
    const user = userEvent.setup();
    render(<EventHarness />);

    await user.click(screen.getByRole("textbox", { name: "搜索事件或添加筛选条件" }));
    await user.click(screen.getByRole("button", { name: /事件按事件类型/ }));
    await user.click(screen.getByRole("button", { name: "全部点击" }));

    expect(screen.getByText("事件：全部点击")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "移除筛选：事件：全部点击" }));
    expect(screen.queryByText("事件：全部点击")).toBeNull();
  });

  it("keeps multiple API methods visible in the common input", async () => {
    const user = userEvent.setup();
    render(<APIHarness />);

    await user.click(screen.getByRole("textbox", { name: "搜索 API 或添加筛选条件" }));
    await user.click(screen.getByRole("button", { name: "GET" }));
    await user.click(screen.getByRole("button", { name: "POST" }));

    expect(screen.getByText("方法：GET")).toBeTruthy();
    expect(screen.getByText("方法：POST")).toBeTruthy();
  });

  it("preserves quoted log terms and exposes severity as a token", async () => {
    expect(splitTerms('user.id:"customer 123" checkout failed')).toEqual([
      'user.id:"customer 123"',
      "checkout",
      "failed",
    ]);
    const user = userEvent.setup();
    render(<LogHarness />);

    await user.click(screen.getByRole("textbox", { name: "搜索日志或添加筛选条件" }));
    await user.click(screen.getByRole("button", { name: "错误日志" }));

    expect(screen.getByText("级别：ERROR")).toBeTruthy();
  });

  it("suggests fields by technical key while the user types", async () => {
    const user = userEvent.setup();
    render(<LogHarness />);

    const input = screen.getByRole("textbox", { name: "搜索日志或添加筛选条件" });
    await user.click(input);
    await user.type(input, "u", { skipClick: true });

    const userField = screen.getByRole("button", { name: /用户 ID按 SDK/ });
    const levelField = screen.getByRole("button", { name: /日志级别TRACE/ });
    expect(userField.compareDocumentPosition(levelField) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

function EventHarness() {
  const [filters, setFilters] = useState<BehaviorFilters>({
    projectId: "11111111-1111-4111-8111-111111111111",
    from: new Date("2026-09-14T00:00:00.000Z"),
    to: new Date("2026-09-15T00:00:00.000Z"),
    dimension: "country",
  });
  return (
    <EventFilterComposer
      filters={filters}
      onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
    />
  );
}

function APIHarness() {
  const [filters, setFilters] = useState<APIFilters>({
    projectId: "11111111-1111-4111-8111-111111111111",
    from: new Date("2026-09-14T00:00:00.000Z"),
    to: new Date("2026-09-15T00:00:00.000Z"),
    methods: [],
    sort: "requests",
  });
  return (
    <ApiFilterBar
      filters={filters}
      onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
    />
  );
}

function LogHarness() {
  const [filters, setFilters] = useState<LogFilters>({
    projectId: "11111111-1111-4111-8111-111111111111",
    from: "2026-09-14T00:00:00.000Z",
    to: "2026-09-15T00:00:00.000Z",
  });
  return (
    <LogFilterComposer
      filters={filters}
      onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
    />
  );
}
