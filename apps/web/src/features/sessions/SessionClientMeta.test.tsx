// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SessionClientMeta } from "./SessionClientMeta";

afterEach(cleanup);

it("renders recognizable country, device and browser metadata without dot separators", () => {
  const { container, getByLabelText } = render(
    <SessionClientMeta country="CN" deviceType="desktop" browser="Chrome" />,
  );

  expect(container.textContent).toContain("🇨🇳");
  expect(getByLabelText("CN，desktop，Chrome")).toBeTruthy();
  expect(container.textContent).not.toContain("CN");
  expect(container.textContent).not.toContain("桌面端");
  expect(container.textContent).not.toContain("·");
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  expect(container.querySelector('[data-icon-source="devicon:chrome"]')).toBeTruthy();
});

it("uses the selected Devicon artwork for Safari", () => {
  const { container } = render(<SessionClientMeta browser="Mobile Safari" />);

  expect(container.querySelector('[data-icon-source="devicon:safari"]')).toBeTruthy();
});

it("falls back safely for non-ISO country values and missing metadata", () => {
  const fallback = render(<SessionClientMeta country="unknown" />);
  expect(fallback.container.textContent).toContain("🌐");
  fallback.unmount();

  const empty = render(<SessionClientMeta />);
  expect(empty.container.textContent).toBe("未知设备");
});
