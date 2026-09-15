// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisFilterSidebar } from "./AnalysisFilterSidebar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe("shared filter sidebar", () => {
  const fields = [{ key: "route", label: "路由", value: "/checkout", text: true, options: [] }];
  it("batches drafts and applies only when explicitly submitted", () => {
    const apply = vi.fn();
    const view = render(
      <AnalysisFilterSidebar fields={fields} onApply={apply}>
        结果
      </AnalysisFilterSidebar>,
    );
    fireEvent.change(view.getByLabelText("路由"), { target: { value: "/products" } });
    expect(apply).not.toHaveBeenCalled();
    expect(view.getByText("有未应用的条件")).toBeTruthy();
    fireEvent.click(view.getByText("撤销修改"));
    expect((view.getByLabelText("路由") as HTMLInputElement).value).toBe("/checkout");
    fireEvent.change(view.getByLabelText("路由"), { target: { value: " /orders " } });
    fireEvent.click(view.getByText("应用筛选"));
    expect(apply).toHaveBeenCalledWith({ route: "/orders" });
  });
  it("collapses persistently without clearing applied filters", () => {
    const apply = vi.fn();
    const view = render(
      <AnalysisFilterSidebar fields={fields} onApply={apply}>
        结果
      </AnalysisFilterSidebar>,
    );
    fireEvent.click(view.getByRole("button", { name: "收起筛选侧栏" }));
    expect(view.queryByRole("complementary")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    view.unmount();
    const restored = render(
      <AnalysisFilterSidebar fields={fields} onApply={apply}>
        结果
      </AnalysisFilterSidebar>,
    );
    expect(restored.queryByRole("complementary")).toBeNull();
    fireEvent.click(restored.getByRole("button", { name: "移除路由筛选" }));
    expect(apply).toHaveBeenCalledWith({ route: undefined });
  });
});
