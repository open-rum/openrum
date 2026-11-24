export type OriginIssue = { line: number; message: string; suggestion?: string };

/** Validate the creation form against the API's explicit HTTP(S) origin contract. */
export function validateProjectOrigins(value: string) {
  const origins: string[] = [];
  const issues: OriginIssue[] = [];
  const lines = value.split("\n");
  const entries = lines.filter((line) => line.trim());
  if (!entries.length) {
    issues.push({ line: 0, message: "请填写至少一个允许上报的站点。" });
  } else if (entries.length > 64) {
    issues.push({ line: 0, message: "最多可填写 64 个站点。" });
  }
  lines.forEach((line, index) => {
    const input = line.trim();
    if (!input) return;
    try {
      const authority = input.match(/^https?:\/\/([^/?#]+)(.*)$/i);
      const url = new URL(input);
      if (
        !authority ||
        input.length > 2048 ||
        /[\s\\*]/.test(input) ||
        authority[1].includes("@") ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        throw new Error("invalid origin");
      }
      // Preserve explicitly supplied ports, matching the server's canonicalization.
      const origin = `${url.protocol}//${authority[1].toLowerCase()}`;
      if (authority[2]) {
        issues.push({
          line: index + 1,
          message: "站点地址不能包含路径、查询参数、片段或结尾斜杠。",
          suggestion: origin,
        });
      } else {
        origins.push(origin);
      }
    } catch {
      issues.push({
        line: index + 1,
        message: "请填写完整的 http:// 或 https:// 站点地址，不支持通配符或账号信息。",
      });
    }
  });
  return { origins: [...new Set(origins)], issues };
}
