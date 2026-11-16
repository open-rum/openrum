// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsolePageHeader } from "./ConsolePage";

afterEach(cleanup);

describe("ConsolePageHeader document title", () => {
  it("names the tab after the page and restores the product name on leave", () => {
    const view = render(<ConsolePageHeader title="告警" />);
    expect(document.title).toBe("告警 · OpenRUM");
    view.rerender(<ConsolePageHeader title={<span>自定义</span>} documentTitle="仪表盘" />);
    expect(document.title).toBe("仪表盘 · OpenRUM");
    view.unmount();
    expect(document.title).toBe("OpenRUM");
  });
});

describe("ConsolePageHeader breadcrumbs", () => {
  it("links earlier items and marks the last as the current page", () => {
    const onNavigate = vi.fn();
    const view = render(
      <ConsolePageHeader
        title="/checkout"
        breadcrumbs={[
          { label: "真实用户性能", href: "/projects/p1/performance", onNavigate },
          { label: "/checkout" },
        ]}
      />,
    );
    const nav = view.getByRole("navigation", { name: "面包屑" });
    expect(nav.querySelector("[aria-current=page]")!.textContent).toBe("/checkout");
    const link = view.getByRole("link", { name: "真实用户性能" });
    expect(link.getAttribute("href")).toBe("/projects/p1/performance");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    // A modified click opens the link normally instead of navigating in place.
    fireEvent.click(link, { metaKey: true });
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
