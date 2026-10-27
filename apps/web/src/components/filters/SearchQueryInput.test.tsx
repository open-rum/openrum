// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobeIcon, RouteIcon, TimerIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SearchQueryInput,
  type SearchQueryError,
  type SearchQueryField,
  type SearchQueryOption,
} from "./SearchQueryInput";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

const fields: SearchQueryField[] = [
  { key: "user.id", type: "text", label: "用户 ID", hint: "user.id", icon: UserIcon },
  {
    key: "browser",
    type: "enum",
    label: "浏览器",
    hint: "Chrome、Safari",
    icon: GlobeIcon,
    options: [
      { value: "Chrome", label: "Chrome" },
      { value: "Safari", label: "Safari" },
    ],
  },
  { key: "route", type: "text", label: "页面 Route", hint: "页面", icon: RouteIcon },
  { key: "duration", type: "duration", label: "耗时", hint: "耗时", icon: TimerIcon },
];

function Harness({
  initial = "",
  suggest,
  error,
}: {
  initial?: string;
  suggest?: (field: SearchQueryField, contains: string) => Promise<SearchQueryOption[]>;
  error?: SearchQueryError;
}) {
  const [q, setQ] = useState(initial);
  return (
    <>
      <SearchQueryInput
        ariaLabel="搜索"
        value={q}
        onSubmit={(next) => setQ(next ?? "")}
        fields={fields}
        attributes
        suggest={suggest}
        recentKey="test"
        freeTextLabel="正文"
        error={error}
        shortcuts={[{ label: "有 Trace", term: "has:trace_id" }]}
      />
      <output aria-label="q">{q}</output>
    </>
  );
}

const box = () => screen.getByRole("combobox", { name: "搜索" }) as HTMLInputElement;
const submitted = () => screen.getByRole("status", { name: "q" }).textContent;

describe("query text search box", () => {
  it("writes field and value as text and joins conditions with AND", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole("option", { name: /用户 ID/ }));
    expect(box().value).toBe("user.id:");
    await user.type(box(), "customer 1");
    // A value with a space is quoted when it is written; typing it is left as typed.
    await user.clear(box());
    await user.type(box(), 'user.id:"customer 1" ');
    await user.click(screen.getByRole("option", { name: /浏览器/ }));
    expect(box().value).toBe('user.id:"customer 1" AND browser:');
    await user.click(screen.getByRole("option", { name: "Chrome" }));
    expect(box().value).toBe('user.id:"customer 1" AND browser:Chrome');
    expect(submitted()).toBe('user.id:"customer 1" AND browser:Chrome');
  });

  it("rewrites the condition under the caret when an operator is chosen", async () => {
    const user = userEvent.setup();
    render(<Harness initial="browser:Chrome AND route:/a" />);
    const input = box();
    await user.click(input);
    // Put the caret inside the first condition.
    act(() => {
      input.setSelectionRange(10, 10);
      fireEvent.select(input);
    });
    expect(screen.getByText("当前条件：浏览器 是 Chrome")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "不是" }));
    expect(input.value).toBe("!browser:Chrome AND route:/a");
  });

  it("collects a list and runs the search on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole("option", { name: /浏览器/ }));
    await user.click(screen.getByRole("button", { name: "属于其中之一" }));
    await user.click(screen.getByRole("option", { name: "Chrome" }));
    await user.click(screen.getByRole("option", { name: "Safari" }));
    expect(box().value).toBe("browser:[Chrome,Safari]");
    expect(submitted()).toBe("");
    await user.type(box(), "{Enter}");
    expect(submitted()).toBe("browser:[Chrome,Safari]");
  });

  it("adds has-conditions and shortcuts at once", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole("button", { name: "有 Trace" }));
    expect(submitted()).toBe("has:trace_id");
    await user.type(box(), " ");
    await user.click(screen.getByRole("option", { name: /页面 Route/ }));
    await user.click(screen.getByRole("button", { name: "没有值" }));
    expect(submitted()).toBe("has:trace_id AND !has:route");
  });

  it("starts a comparison field on 大于 and keeps typed text as written", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole("option", { name: /耗时/ }));
    expect(screen.getByRole("button", { name: "大于" }).getAttribute("aria-pressed")).toBe("true");
    await user.type(box(), ">2s attributes.plan:pro{Enter}");
    expect(submitted()).toBe("duration:>2s attributes.plan:pro");
  });

  it("colours the parts of the query and marks the refused condition", () => {
    const { container } = render(
      <Harness
        initial="browser:Chrome AND foo:1"
        error={{ message: "这个页面不能按「foo:1」里的字段搜索。", position: 19, term: "foo:1" }}
      />,
    );
    const kinds = [...container.querySelectorAll(".search-query__highlight [data-kind]")].map(
      (part) => `${part.getAttribute("data-kind")}:${part.textContent}`,
    );
    expect(kinds).toEqual(
      expect.arrayContaining(["field:browser", "value:Chrome", "keyword:AND", "field:foo"]),
    );
    const invalid = [...container.querySelectorAll("[data-invalid]")].map(
      (part) => part.textContent,
    );
    expect(invalid.join("")).toContain("foo");
    expect(screen.getByRole("alert").textContent).toContain("foo:1");
    expect(box().getAttribute("aria-invalid")).toBe("true");
  });

  it("has no 查询 button and says when an edit has not run yet", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "查询" })).toBeNull();
    expect(box().getAttribute("enterkeyhint")).toBe("search");
    expect(screen.queryByText("按 Enter 搜索")).toBeNull();
    await user.type(box(), "timeout");
    expect(screen.getByText("按 Enter 搜索")).toBeTruthy();
    await user.type(box(), "{Enter}");
    expect(submitted()).toBe("timeout");
    expect(screen.queryByText("按 Enter 搜索")).toBeNull();
  });

  it("remembers submitted queries in this browser", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), "browser:Safari{Enter}");
    await user.click(screen.getByLabelText("清空查询"));
    await user.click(box());
    await user.click(screen.getByRole("option", { name: /browser:Safari最近搜索/ }));
    expect(submitted()).toBe("browser:Safari");
  });

  it("asks the server for values once typing pauses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const suggest = vi.fn(async () => [{ value: "/checkout", label: "/checkout", count: 9 }]);
    render(<Harness suggest={suggest} />);
    await user.click(box());
    await user.click(screen.getByRole("option", { name: /页面 Route/ }));
    await user.type(box(), "che");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => expect(screen.getByRole("option", { name: /\/checkout/ })).toBeTruthy());
    expect(suggest).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "route" }),
      "che",
      expect.anything(),
    );
    expect(suggest.mock.calls.some((call) => (call as unknown[])[1] === "c")).toBe(false);
  });

  it("does not ask the server for values while the suggestions are closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const suggest = vi.fn(async () => []);
    render(<Harness initial='user.id:"customer-123"' suggest={suggest} />);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(suggest).not.toHaveBeenCalled();
  });

  it("shows a page's new query when it changes from outside", () => {
    const { rerender } = render(
      <SearchQueryInput ariaLabel="搜索" value="a" onSubmit={() => undefined} fields={fields} />,
    );
    rerender(
      <SearchQueryInput
        ariaLabel="搜索"
        value="browser:Safari"
        onSubmit={() => undefined}
        fields={fields}
      />,
    );
    expect(box().value).toBe("browser:Safari");
  });
});
