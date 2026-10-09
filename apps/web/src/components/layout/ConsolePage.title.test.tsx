// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
