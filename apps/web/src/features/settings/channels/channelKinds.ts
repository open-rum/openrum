import type { StoredChannelKind } from "@/lib/api/alerts";

// The Console's view of notification channel kinds. "available" kinds match the
// registry in internal/notify/kinds.go; the rest are shown disabled until delivery for
// them ships. See docs/agents/alerts.md before adding one.
export type ChannelKindId = StoredChannelKind | "dingtalk" | "wecom" | "slack" | "email";

export type ChannelField = {
  key: string;
  label: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  secret?: boolean;
  maxLength: number;
  /** Returns an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
};

export type ChannelKindDefinition = {
  id: ChannelKindId;
  name: string;
  description: string;
  status: "available" | "soon";
  docsSlug?: string;
  fields: ChannelField[];
};

const feishuHook =
  /^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[^/?#]+$/;

export const channelKinds: ChannelKindDefinition[] = [
  {
    id: "feishu",
    name: "飞书",
    description: "推送卡片消息到飞书群机器人",
    status: "available",
    docsSlug: "product/alerts/feishu/",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook 地址",
        placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
        description: "飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人，复制 Webhook 地址。",
        required: true,
        secret: true,
        maxLength: 512,
        validate: (value) =>
          feishuHook.test(value.trim()) ? null : "请填写飞书或 Lark 自定义机器人的 Webhook 地址。",
      },
      {
        key: "secret",
        label: "签名校验密钥",
        placeholder: "可选，推荐开启",
        description: "在机器人安全设置里开启「签名校验」后复制密钥。",
        required: false,
        secret: true,
        maxLength: 128,
      },
    ],
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "向你的 HTTPS 服务发送签名 JSON",
    status: "available",
    docsSlug: "product/alerts/webhook/",
    fields: [
      {
        key: "url",
        label: "HTTPS 地址",
        placeholder: "https://hooks.example.com/openrum",
        required: true,
        maxLength: 2048,
        validate: (value) =>
          /^https:\/\/[^/\s]+/.test(value.trim()) ? null : "请填写 HTTPS 地址。",
      },
      {
        key: "secret",
        label: "签名密钥",
        placeholder: "至少 16 个字符",
        description: "用于计算请求头 X-OpenRUM-Signature，接收方据此验证请求来源。",
        required: true,
        secret: true,
        maxLength: 256,
        validate: (value) => (value.trim().length >= 16 ? null : "签名密钥至少 16 个字符。"),
      },
    ],
  },
  { id: "dingtalk", name: "钉钉", description: "钉钉群机器人", status: "soon", fields: [] },
  { id: "wecom", name: "企业微信", description: "企业微信群机器人", status: "soon", fields: [] },
  { id: "slack", name: "Slack", description: "Slack Incoming Webhook", status: "soon", fields: [] },
  { id: "email", name: "邮件", description: "通过 SMTP 发送邮件", status: "soon", fields: [] },
];

export function channelKind(id: string) {
  return channelKinds.find((kind) => kind.id === id || (id === "smtp" && kind.id === "email"));
}
