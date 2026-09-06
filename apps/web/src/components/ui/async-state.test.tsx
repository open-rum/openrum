// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HTTPError } from "@/lib/auth/session";
import { AsyncError, AsyncLoading } from "./AsyncState";
import { EmptyState } from "./EmptyState";

describe("shared async states", () => {
  it("shows remediation, request ID and a retry action", () => {
    const retry = vi.fn();
    render(
      <AsyncError
        error={new HTTPError(503, "QUERY_UNAVAILABLE", "req-42", "failed")}
        title="加载失败"
        remediation="缩短时间范围。"
        onRetry={retry}
      />,
    );
    expect(screen.getByText(/Request ID: req-42/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("provides explicit loading and actionable empty copy", () => {
    const { rerender } = render(<AsyncLoading label="正在加载问题" />);
    expect(screen.getByLabelText("正在加载问题").getAttribute("aria-busy")).toBe("true");
    rerender(<EmptyState title="当前范围没有事件" description="扩大时间范围后重试。" />);
    expect(screen.getByText("扩大时间范围后重试。")).toBeTruthy();
  });
});
