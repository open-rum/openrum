import { describe, expect, it } from "vitest";
import { channelKind, channelKinds } from "./channelKinds";

describe("channel kinds", () => {
  it("offers Feishu and Webhook today and shows the rest as coming soon", () => {
    const available = channelKinds
      .filter((kind) => kind.status === "available")
      .map((kind) => kind.id);
    // Must match the registry in internal/notify/kinds.go.
    expect(available).toEqual(["feishu", "webhook"]);
    const soon = channelKinds.filter((kind) => kind.status === "soon").map((kind) => kind.id);
    expect(soon).toEqual(["dingtalk", "wecom", "slack", "email"]);
    for (const kind of channelKinds.filter((item) => item.status === "soon"))
      expect(kind.fields).toEqual([]);
  });

  it("accepts only Feishu or Lark bot hooks for Feishu", () => {
    const hook = channelKind("feishu")!.fields.find((field) => field.key === "webhookUrl")!;
    expect(hook.validate!("https://open.feishu.cn/open-apis/bot/v2/hook/abc")).toBeNull();
    expect(hook.validate!("https://open.larksuite.com/open-apis/bot/v2/hook/abc")).toBeNull();
    expect(hook.validate!("https://hooks.example.com/abc")).not.toBeNull();
    expect(hook.validate!("http://open.feishu.cn/open-apis/bot/v2/hook/abc")).not.toBeNull();
    expect(channelKind("feishu")!.fields.find((field) => field.key === "secret")!.required).toBe(
      false,
    );
  });

  it("maps stored SMTP channels onto the email kind", () => {
    expect(channelKind("smtp")?.id).toBe("email");
  });
});
