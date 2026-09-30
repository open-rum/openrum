/**
 * The fixed environments a project can report under. Mirrors `projectEnvironments` in
 * services/api/internal/handlers/projects.go and the browser SDK's `Environment` type.
 */
export const projectEnvironments = [
  { id: "development", label: "开发" },
  { id: "test", label: "测试" },
  { id: "staging", label: "灰度" },
  { id: "production", label: "生产" },
] as const;

export type ProjectEnvironment = (typeof projectEnvironments)[number]["id"];

export function isProjectEnvironment(value: string): value is ProjectEnvironment {
  return projectEnvironments.some((item) => item.id === value);
}

export function environmentLabel(value: string) {
  return projectEnvironments.find((item) => item.id === value)?.label ?? value;
}

/** Newline-separated form value to a deduplicated list, in the canonical order. */
export function parseEnvironments(value: string) {
  const chosen = new Set(value.split("\n").map((line) => line.trim()));
  return projectEnvironments.filter((item) => chosen.has(item.id)).map((item) => item.id);
}
