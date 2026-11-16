// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogDetails } from "./LogDetails";
import { logWithTwentyAttributes } from "./__fixtures__/logDetails";

const props = {
  entry: logWithTwentyAttributes,
  open: true,
  loading: false,
  error: null,
  projectId: "preview-project",
  columns: [],
  onClose: vi.fn(),
  onFilter: vi.fn(),
  onColumn: vi.fn(),
  onRelated: vi.fn(),
  onRetry: vi.fn(),
};
afterEach(cleanup);

describe("log attribute views", () => {
  it("shows all twenty attributes and retains field actions after switching back", async () => {
    const user = userEvent.setup();
    render(<LogDetails {...props} />);
    const fields = screen.getByRole("region", { name: "属性列表" });
    expect(within(fields).getAllByRole("row")).toHaveLength(21);
    expect(within(fields).getByText("debug.note")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "JSON" }));
    await user.click(screen.getByRole("radio", { name: "JSON" }));
    expect(screen.getByRole("radio", { name: "JSON" }).getAttribute("aria-checked")).toBe("true");
    const json = screen.getByLabelText("属性 JSON");
    expect(JSON.parse(json.textContent!)).toEqual(logWithTwentyAttributes.attributes);
    expect(json.querySelector("script")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "列表" }));
    await user.click(screen.getByRole("button", { name: "error.code 操作" }));
    expect(screen.getByRole("menuitem", { name: "按此值筛选" })).toBeTruthy();
  });

  it("copies the displayed attribute JSON without adding other log fields", async () => {
    const user = userEvent.setup();
    render(<LogDetails {...props} />);
    await user.click(screen.getByRole("radio", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "复制属性 JSON" }));
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual(
      logWithTwentyAttributes.attributes,
    );
  });

  it("renders an empty object and updates JSON when switching logs", async () => {
    const user = userEvent.setup();
    const view = render(<LogDetails {...props} />);
    await user.click(screen.getByRole("radio", { name: "JSON" }));
    view.rerender(<LogDetails {...props} entry={{ ...logWithTwentyAttributes, attributes: {} }} />);
    expect(screen.getByLabelText("属性 JSON").textContent).toBe("{}");
    view.rerender(
      <LogDetails
        {...props}
        entry={{
          ...logWithTwentyAttributes,
          eventId: "another-log",
          attributes: { source: "next log" },
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "JSON" }));
    expect(JSON.parse(screen.getByLabelText("属性 JSON").textContent!)).toEqual({
      source: "next log",
    });
  });
});
