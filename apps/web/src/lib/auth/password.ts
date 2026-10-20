/**
 * The one password rule every sign-up and password change shares, and the one the API
 * enforces (`auth.ValidatePassword`): at least 8 characters with an upper-case letter, a
 * lower-case letter and a symbol.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const passwordRuleHint = "至少 8 个字符，须同时包含大写字母、小写字母和符号。";

/** For an input's `pattern`, so the browser stops a weak password before it is sent. */
export const passwordPattern = String.raw`(?=.*\p{Ll})(?=.*\p{Lu})(?=.*[\p{P}\p{S}]).{8,}`;

/** What a password still lacks, in plain words. Empty means it follows the rule. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) problems.push("至少 8 个字符");
  if (!/\p{Lu}/u.test(password)) problems.push("大写字母");
  if (!/\p{Ll}/u.test(password)) problems.push("小写字母");
  if (!/[\p{P}\p{S}]/u.test(password)) problems.push("符号");
  return problems;
}

export function passwordRuleMessage(password: string): string | null {
  const problems = passwordProblems(password);
  if (!problems.length) return null;
  return `密码还需要：${problems.join("、")}。`;
}
