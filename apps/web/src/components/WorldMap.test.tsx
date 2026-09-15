// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WorldMap } from "./WorldMap";

afterEach(cleanup);

it("renders real values, zero, small regions and unmapped groups without a fake focus country", () => {
  const { container, getByRole } = render(
    <WorldMap
      title="国家分布"
      metricLabel="用户数"
      formatValue={String}
      data={[
        { code: "US", value: 100 },
        { code: "CN", value: 0 },
        { code: "SG", value: 8 },
        { code: "ZZ", value: 2 },
      ]}
    />,
  );
  expect(getByRole("button", { name: "中国 (CN) · 用户数 0" })).toBeTruthy();
  expect(getByRole("button", { name: "美国 (US) · 用户数 100" })).toBeTruthy();
  expect(container.querySelector('[data-country-id="702"] circle')).not.toBeNull();
  expect(container.querySelector('[data-country-id="392"] path')?.getAttribute("fill")).toBe(
    "var(--ds-surface-subtle)",
  );
  expect(container.querySelector('[data-country-id="840"] path')?.getAttribute("fill")).toContain(
    "100%",
  );
  expect(getByRole("status").textContent).toContain("1 个分组未定位");
  expect(container.textContent).not.toContain("当前突出中国");
});
