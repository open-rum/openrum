---
title: 威胁模型
description: 公开部署实例的信任边界、威胁、控制与剩余风险。
---

## 范围与信任边界

OpenRUM 通过公开 Ingest 接收不可信浏览器遥测，通过 Console/API 为已认证运维人员服务。
Kafka、ClickHouse、PostgreSQL、Redis 和对象存储属于私有依赖；Kubernetes Secret、工作负载身份、
Source Map 和通知渠道凭据是敏感资产。项目 ID 与组织 ID 本身绝不是授权依据。

## 威胁与控制

| 威胁 | 主要控制 | 验证 |
| --- | --- | --- |
| 跨租户读写 | 仓储查询校验组织成员；未授权资源返回 Not Found | 租户隔离与认证测试 |
| Session 窃取 / CSRF | Secure HttpOnly、SameSite、绝对/空闲 TTL、同源与双提交 Token | Auth/CSRF 测试 |
| Write Key 滥用 | Hash Key、Origin Allowlist、轮换/撤销、项目/IP 限制、Payload 上限 | Ingest 测试 |
| 事件中的隐私与 Secret | URL 归一化、敏感 Key 移除、邮箱/Token/JWT/卡号清洗、属性限长 | Privacy Fixture |
| 解压/解析耗尽 | 压缩和原始字节上限、压缩比上限、单 Gzip Member | Bomb 测试 |
| Webhook SSRF | 仅 HTTPS、请求与跳转前验证公网 IP、禁用 Proxy、HMAC、加密配置 | 安全测试 |
| Source Map 篡改 | 作用域不可变 Key、预期大小/SHA-256、私有 Bucket | Artifact 测试 |
| 上传令牌滥用 | 按项目签发并哈希存储、仅能上传和列出、不能删除、可吊销、显示最近使用时间 | 上传令牌鉴权测试 |
| 队列/数据库故障 | `acks=all` 后成功、写入前不提交 Offset、有界重试与背压 | Pipeline/Runbook |

## 安全不变量

- Ingest 返回成功表示 Kafka 已耐久确认信封。
- 任何 API 仓储都不能只凭项目 ID 访问，必须解析已认证用户的组织成员关系。
- Secret、Session Token 和签名 URL 不会在一次性展示后被记录或返回；浏览器 DSN 对授权项目用户可见。
- Webhook 每次请求和跳转都重新验证 DNS，拒绝私网、Loopback、Link-local 和 CGNAT 地址。
- 自动恢复不得执行破坏性 Schema 回滚、公开 Bucket 或削弱 Kafka 耐久性。

## 剩余风险

用户自由文本可能包含清洗器无法识别的标识符，运维方应保守配置采集并限制保留期。浏览器 Write Key
本来就是公开的，其保护依赖 Origin 与速率控制而不是保密。关键/高危发现应阻止上线，除非安全负责人
明确接受并记录负责人、到期时间和补偿控制。
