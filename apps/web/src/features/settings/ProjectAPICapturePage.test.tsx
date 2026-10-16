// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateAPICapture, type APICapture, type CaptureRule } from "@/lib/api/apiCapture";
import { APICaptureForm } from "./ProjectAPICapturePage";

vi.mock("@/lib/api/apiCapture", async (original) => ({
  ...(await original<typeof import("@/lib/api/apiCapture")>()),
  updateAPICapture: vi.fn(),
}));

const save = vi.mocked(updateAPICapture);
const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";
const limits = { retentionDays: 3, maxRules: 20, maxHeaders: 20 };
const orders: CaptureRule = {
  id: "orders",
  method: "GET",
  pattern: "https://api.example.com/orders/:id",
  requestHeaders: ["x-request-id"],
  responseHeaders: ["etag", "content-type"],
  requestBody: false,
  responseBody: true,
  note: "debugging cache",
};

function mount(
  props: {
    rules?: CaptureRule[];
    start?: { method?: string; url: string };
    canManage?: boolean;
  } = {},
) {
  const initial: APICapture = { rules: props.rules ?? [], ...limits };
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <APICaptureForm
        projectId={projectId}
        initial={initial}
        start={props.start}
        canManage={props.canManage ?? true}
        role={props.canManage === false ? "viewer" : "owner"}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  save.mockReset();
  save.mockImplementation(async (_project, rules) => ({ rules, ...limits }));
});
afterEach(cleanup);

describe("APICaptureForm", () => {
  it("starts with nothing captured and says what stays private", () => {
    mount();
    expect(screen.getByText("还没有规则，所有 API 的头信息都不采集。")).toBeTruthy();
    expect(screen.getByText(/默认全部不采集/)).toBeTruthy();
    expect(screen.getByText(/凭证类头永远不会采集/)).toBeTruthy();
    expect(screen.getByText(/请求体和响应体需要单独勾选/)).toBeTruthy();
    expect(screen.getByText("3 天", { selector: "strong" })).toBeTruthy();
  });

  it("shows an existing rule's headers as editable text", () => {
    mount({ rules: [orders] });
    expect((screen.getByLabelText("规则 1 的方法") as HTMLSelectElement).value).toBe("GET");
    expect((screen.getByLabelText("规则 1 的 API 地址") as HTMLInputElement).value).toBe(
      "https://api.example.com/orders/:id",
    );
    expect((screen.getByLabelText("规则 1 的请求头") as HTMLInputElement).value).toBe(
      "x-request-id",
    );
    expect((screen.getByLabelText("规则 1 的响应头") as HTMLInputElement).value).toBe(
      "etag, content-type",
    );
  });

  it("saves typed header names as a clean, lower-case, de-duplicated list", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.change(screen.getByLabelText("规则 1 的方法"), { target: { value: "POST" } });
    fireEvent.change(screen.getByLabelText("规则 1 的 API 地址"), {
      target: { value: " https://api.example.com/orders " },
    });
    fireEvent.change(screen.getByLabelText("规则 1 的请求头"), {
      target: { value: "X-Request-Id,  accept x-request-id" },
    });
    fireEvent.change(screen.getByLabelText("规则 1 的响应头"), { target: { value: "ETag" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [project, rules] = save.mock.calls[0];
    expect(project).toBe(projectId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      method: "POST",
      pattern: "https://api.example.com/orders",
      requestHeaders: ["x-request-id", "accept"],
      responseHeaders: ["etag"],
    });
    expect(rules[0]).toMatchObject({ requestBody: false, responseBody: false });
    expect(rules[0]).not.toHaveProperty("note");
    expect(await screen.findByText(/已保存/)).toBeTruthy();
  });

  it("drops the pre-fill notice once the rule is saved", async () => {
    mount({ start: { method: "GET", url: "https://shop.example.com/api/orders/:id" } });
    expect(screen.getByText(/已按你在 API 监控中查看的端点预填/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/已保存/);
    expect(screen.queryByText(/已按你在 API 监控中查看的端点预填/)).toBeNull();
  });

  it("opts bodies in per direction, with a warning only while one is on", async () => {
    mount({ rules: [{ ...orders, responseBody: false }] });
    expect(screen.queryByText(/正文常含个人信息/)).toBeNull();
    fireEvent.click(screen.getByLabelText("规则 1 采集请求体"));
    expect(screen.getByText(/正文常含个人信息/)).toBeTruthy();
    expect((screen.getByLabelText("规则 1 采集响应体") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1][0]).toMatchObject({ requestBody: true, responseBody: false });
  });

  it("shows an existing rule's body choices", () => {
    mount({ rules: [orders] });
    expect((screen.getByLabelText("规则 1 采集请求体") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("规则 1 采集响应体") as HTMLInputElement).checked).toBe(true);
  });

  it("removes a rule, which is how an endpoint is switched off", async () => {
    mount({ rules: [orders] });
    fireEvent.click(screen.getByRole("button", { name: "删除规则 1" }));
    expect(screen.getByText("还没有规则，所有 API 的头信息都不采集。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(projectId, []));
  });

  it("starts a rule from the endpoint API monitoring linked with, and saves only on request", () => {
    mount({ start: { method: "POST", url: "https://shop.example.com/api/order/submit" } });
    expect(screen.getByRole("status").textContent).toMatch(/预填/);
    expect((screen.getByLabelText("规则 1 的方法") as HTMLSelectElement).value).toBe("POST");
    expect((screen.getByLabelText("规则 1 的 API 地址") as HTMLInputElement).value).toBe(
      "https://shop.example.com/api/order/submit",
    );
    expect((screen.getByLabelText("规则 1 的响应头") as HTMLInputElement).value).toBe(
      "content-type, x-request-id",
    );
    // Pre-filling is not consent: nothing was sent.
    expect(save).not.toHaveBeenCalled();
  });

  it("does not add a second rule for an endpoint that already has one", () => {
    mount({
      rules: [orders],
      start: { method: "GET", url: "https://api.example.com/orders/:id" },
    });
    expect(screen.queryByLabelText("规则 2 的方法")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the server's reason when a rule is refused", async () => {
    save.mockRejectedValue(new Error("rule cannot capture authorization"));
    mount({ rules: [orders] });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/rule cannot capture authorization/)).toBeTruthy();
  });

  it("is read-only for a role that cannot manage the project", () => {
    mount({ rules: [orders], canManage: false });
    expect(screen.getByText(/只有 Owner 或 Admin 可以修改/)).toBeTruthy();
    expect((screen.getByLabelText("规则 1 的响应头") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "添加规则" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
