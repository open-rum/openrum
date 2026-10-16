// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BehaviorFilters } from "@/lib/api/analytics";
import type { APIFilters } from "@/lib/api/apis";
import type { LogFilters } from "@/lib/api/logs";
import { ApiFilterBar } from "@/features/apis/ApiFilters";
import { EventFilterComposer } from "@/features/events/EventFilterComposer";
import { LogFilterComposer } from "@/features/logs/LogFilterComposer";
import { splitTerms } from "@/features/logs/logFilterQuery";
import { GlobeIcon, TagIcon } from "lucide-react";
import {
  FilterSearchComposer,
  type FilterSearchField,
  type FilterSearchToken,
} from "./FilterSearchComposer";

afterEach(cleanup);

describe("shared filter search consumers", () => {
  it("turns an event selection into a removable token", async () => {
    const user = userEvent.setup();
    render(<EventHarness />);

    await user.click(screen.getByRole("combobox", { name: "添加事件筛选条件" }));
    await user.click(screen.getByRole("option", { name: /事件按事件类型/ }));
    await user.click(screen.getByRole("option", { name: "全部点击" }));

    expect(screen.getByText("事件：全部点击")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "移除筛选：事件：全部点击" }));
    expect(screen.queryByText("事件：全部点击")).toBeNull();
  });

  it("keeps multiple API methods visible in the common input", async () => {
    const user = userEvent.setup();
    render(<APIHarness />);

    await user.click(screen.getByRole("combobox", { name: "搜索 API 或添加筛选条件" }));
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

    await user.click(screen.getByRole("combobox", { name: "搜索日志或添加筛选条件" }));
    await user.click(screen.getByRole("button", { name: "错误日志" }));

    expect(screen.getByText("级别：ERROR")).toBeTruthy();
  });

  it("suggests fields by technical key while the user types", async () => {
    const user = userEvent.setup();
    render(<LogHarness />);

    const input = screen.getByRole("combobox", { name: "搜索日志或添加筛选条件" });
    await user.click(input);
    await user.type(input, "u", { skipClick: true });

    const userField = screen.getByRole("option", { name: /用户 ID按 SDK/ });
    const levelField = screen.getByRole("option", { name: /日志级别TRACE/ });
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

const fields: FilterSearchField[] = [
  {
    key: "release",
    label: "版本",
    hint: "按 Release 筛选",
    icon: TagIcon,
    aliases: ["version"],
    options: [
      { value: "2.18.0", label: "2.18.0", count: 12 },
      { value: "2.17.0", label: "2.17.0", count: 3 },
    ],
  },
  { key: "route", label: "路由", hint: "按页面路由筛选", icon: GlobeIcon, options: [] },
  {
    key: "sort",
    label: "排序",
    hint: "选择排序",
    icon: TagIcon,
    allowCustom: false,
    options: [
      { value: "events", label: "事件数" },
      { value: "users", label: "影响用户" },
    ],
  },
];

function mount(
  props: Partial<React.ComponentProps<typeof FilterSearchComposer>> = {},
  tokens: FilterSearchToken[] = [],
) {
  const handlers = {
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onSearch: vi.fn(),
    onClear: vi.fn(),
  };
  const element = (nextTokens: FilterSearchToken[]) => (
    <FilterSearchComposer
      ariaLabel="搜索测试或添加筛选条件"
      fields={fields}
      tokens={nextTokens}
      searchLabel="错误标题"
      {...handlers}
      {...props}
    />
  );
  const view = render(element(tokens));
  return { ...handlers, view, element };
}

const input = () => screen.getByRole("combobox", { name: "搜索测试或添加筛选条件" });

describe("keyboard and semantics", () => {
  it("is a combobox whose suggestions are a listbox of options", async () => {
    const user = userEvent.setup();
    mount();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await user.click(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "筛选建议" });
    expect(input().getAttribute("aria-controls")).toBe(list.id);
    expect(within(list).getAllByRole("option")).toHaveLength(3);
  });

  it("moves through suggestions with the arrow keys and picks one with Enter", async () => {
    const user = userEvent.setup();
    const { onSelect } = mount();
    await user.click(input());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(input().getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    // The second field, 路由, opened; nothing was chosen yet.
    expect(input().getAttribute("placeholder")).toBe("输入路由的值…");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wraps around, and chooses a value in a field the same way", async () => {
    const user = userEvent.setup();
    const { onSelect } = mount();
    await user.click(input());
    await user.keyboard("{ArrowUp}");
    expect(input().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[2].id);
    await user.keyboard("{Enter}"); // 排序
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("sort", "users");
  });

  it("opens a highlighted field with Tab instead of leaving the box", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(input());
    await user.keyboard("ver{Tab}");
    expect(input().getAttribute("placeholder")).toBe("输入版本的值…");
    expect(document.activeElement).toBe(input());
  });

  it("stays open when the box is clicked again, and closes when the page is", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(input());
    await user.click(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await user.click(document.body);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Enter with nothing typed, and clears the text on a second Escape", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(input());
    await user.keyboard("{Enter}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await user.type(input(), "abc");
    await user.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("abc");
    await user.keyboard("{Escape}");
    expect((input() as HTMLInputElement).value).toBe("");
  });
});

describe("what typed text does", () => {
  it("names where plain text goes, and Enter does what it always did", async () => {
    const user = userEvent.setup();
    const { onSearch, onSelect } = mount();
    await user.type(input(), "boom");
    const first = screen.getAllByRole("option")[0];
    expect(first.textContent).toContain("在「错误标题」中搜索");
    expect(first.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    expect(onSearch).toHaveBeenCalledWith("boom");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers no search row when the page has no free-text search", async () => {
    const user = userEvent.setup();
    mount({ onSearch: undefined });
    await user.type(input(), "boom");
    expect(screen.queryByText(/中搜索/)).toBeNull();
    expect(screen.getByText("没有匹配的筛选条件。")).toBeTruthy();
  });

  it("turns `name:` into that field, so the rest is typed as its value", async () => {
    const user = userEvent.setup();
    const { onSelect } = mount();
    await user.type(input(), "release:");
    expect(input().getAttribute("placeholder")).toBe("输入版本的值…");
    expect((input() as HTMLInputElement).value).toBe("");
    await user.type(input(), "2.18{Enter}");
    expect(onSelect).toHaveBeenCalledWith("release", "2.18");
  });

  it("reads one whole `name:value` term, by key, synonym or label", async () => {
    const user = userEvent.setup();
    const { onSelect, onSearch } = mount();
    for (const [typed, field, value] of [
      ["route:/checkout", "route", "/checkout"],
      ['route:"/a b"', "route", "/a b"],
      ["ROUTE:/up", "route", "/up"],
      ["路由:/cn", "route", "/cn"],
    ] as const) {
      await user.type(input(), `${typed}{Enter}`);
      expect(onSelect).toHaveBeenLastCalledWith(field, value);
    }
    // A pasted term never opens the field on the way: it arrives complete. The input is still
    // focused from the last Enter, so no click is needed to paste.
    await user.paste("version:2.17.0");
    expect(screen.getByRole("option", { name: /添加筛选：版本：2\.17\.0/ })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("release", "2.17.0");
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("leaves anything that is not exactly one known term as text", async () => {
    const user = userEvent.setup();
    const { onSelect, onSearch } = mount();
    // Pasted, because typing `release:` already opens the release field on the colon.
    await user.click(input());
    for (const typed of ["unknown:1", "release: crash", "route:/a route:/b", 'route:"/a b']) {
      await user.paste(typed);
      await user.keyboard("{Enter}");
      expect(onSearch).toHaveBeenLastCalledWith(typed);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("matches a choice-only field by label or value, and keeps a draft it cannot accept", async () => {
    const user = userEvent.setup();
    const { onSelect, onSearch } = mount();
    await user.type(input(), "sort:users{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("sort", "users");
    await user.type(input(), "sort:事件数{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("sort", "events");
    await user.type(input(), "sort:bogus{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSearch).not.toHaveBeenCalled();
    // Still in the sort field with what was typed, so it can be corrected.
    expect(input().getAttribute("placeholder")).toBe("输入排序的值…");
    expect((input() as HTMLInputElement).value).toBe("bogus");
  });

  it("does not read terms for a page whose own query language already does", async () => {
    const user = userEvent.setup();
    const { onSelect, onSearch } = mount({ fieldTerms: false, syntaxHint: "例如 trace_id:*" });
    await user.type(input(), "release:2.18.0");
    expect(screen.queryByRole("option", { name: /添加筛选：/ })).toBeNull();
    expect(screen.getByText("例如 trace_id:*")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onSearch).toHaveBeenCalledWith("release:2.18.0");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hints at the syntax with a real field of the page", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(input());
    expect(screen.getByText("可直接输入 字段:值，例如 release:…")).toBeTruthy();
  });
});

describe("conditions", () => {
  const route: FilterSearchToken = {
    key: "route",
    fieldKey: "route",
    value: "/a",
    label: "Route：/a",
  };
  const method: FilterSearchToken = { key: "method:GET", label: "方法：GET" };

  it("edits a single-value condition in place, starting from its value", async () => {
    const user = userEvent.setup();
    const { onSelect } = mount({}, [route, method]);
    expect(screen.queryByRole("button", { name: "编辑筛选：方法：GET" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "编辑筛选：Route：/a" }));
    expect(input().getAttribute("placeholder")).toBe("输入路由的值…");
    expect((input() as HTMLInputElement).value).toBe("/a");
    await user.type(input(), "b{Enter}");
    expect(onSelect).toHaveBeenCalledWith("route", "/ab");
  });

  it("offers 清除全部 from two conditions on", async () => {
    const user = userEvent.setup();
    const first = mount({}, [route]);
    expect(screen.queryByRole("button", { name: "清除全部筛选" })).toBeNull();
    first.view.unmount();
    const second = mount({}, [route, method]);
    await user.click(screen.getByRole("button", { name: "清除全部筛选" }));
    expect(second.onClear).toHaveBeenCalledTimes(1);
  });

  it("asks for a second Backspace before removing the last condition", async () => {
    const user = userEvent.setup();
    const { onRemove } = mount({}, [route, method]);
    await user.click(input());
    await user.keyboard("{Backspace}");
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("再按一次退格删除：方法：GET");
    // Typing anything backs out, so a later Backspace starts over.
    await user.keyboard("x{Backspace}{Backspace}");
    expect(onRemove).not.toHaveBeenCalled();
    await user.keyboard("{Backspace}");
    expect(onRemove).toHaveBeenCalledWith("method:GET");
  });

  it("only shows 查询 when there is something to submit", async () => {
    const user = userEvent.setup();
    const { onSearch } = mount();
    expect(screen.queryByRole("button", { name: "查询" })).toBeNull();
    await user.type(input(), "boom");
    await user.click(screen.getByRole("button", { name: "查询" }));
    expect(onSearch).toHaveBeenCalledWith("boom");
    expect(screen.queryByRole("button", { name: "查询" })).toBeNull();
  });

  it("tells a screen reader what was added and removed", async () => {
    const { view, element } = mount({}, [route]);
    view.rerender(element([route, method]));
    expect(screen.getByRole("status").textContent).toBe("已添加筛选：方法：GET");
    view.rerender(element([method]));
    expect(screen.getByRole("status").textContent).toBe("已移除筛选：Route：/a");
  });
});

describe("on the pages", () => {
  it("keeps the log query language intact: a wildcard stays unquoted", async () => {
    const user = userEvent.setup();
    render(<LogHarness />);
    await user.type(
      screen.getByRole("combobox", { name: "搜索日志或添加筛选条件" }),
      "trace_id:*{Enter}",
    );
    // Read as a term of the query, not as the 'trace_id' field, which would quote the `*`.
    expect(screen.getByText("Trace ID：*")).toBeTruthy();
    expect(screen.queryByText('Trace ID："*"')).toBeNull();
  });

  it("lets the API page change its version condition by clicking it", async () => {
    const user = userEvent.setup();
    render(<APIHarness />);
    const box = screen.getByRole("combobox", { name: "搜索 API 或添加筛选条件" });
    await user.type(box, "release:2.17.0{Enter}");
    expect(screen.getByText("版本：2.17.0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "编辑筛选：版本：2.17.0" }));
    expect(box.getAttribute("placeholder")).toBe("输入版本的值…");
    await user.type(box, "2.18.0{Enter}");
    expect(screen.getByText("版本：2.18.0")).toBeTruthy();
    expect(screen.queryByText("版本：2.17.0")).toBeNull();
  });

  it("clears everything the API box owns in one step", async () => {
    const user = userEvent.setup();
    render(<APIHarness />);
    const box = screen.getByRole("combobox", { name: "搜索 API 或添加筛选条件" });
    await user.type(box, "route:/checkout{Enter}");
    await user.type(box, "release:2.18.0{Enter}");
    await user.click(screen.getByRole("button", { name: "清除全部筛选" }));
    expect(screen.queryByText("版本：2.18.0")).toBeNull();
    expect(screen.queryByText("Route：/checkout")).toBeNull();
  });

  it("does not suggest a text search on the events page, which has none", async () => {
    const user = userEvent.setup();
    render(<EventHarness />);
    await user.type(screen.getByRole("combobox", { name: "添加事件筛选条件" }), "checkout");
    expect(screen.queryByText(/中搜索/)).toBeNull();
  });
});
