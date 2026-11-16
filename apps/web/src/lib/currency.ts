// The currencies a Project can label revenue with. The label is display only: amounts are
// stored as reported and never converted. Keep the codes in step with `revenueCurrencies`
// in `services/api/internal/handlers/projects.go`.
export const REVENUE_CURRENCIES = [
  { code: "CNY", name: "人民币" },
  { code: "USD", name: "美元" },
  { code: "EUR", name: "欧元" },
  { code: "GBP", name: "英镑" },
  { code: "JPY", name: "日元" },
  { code: "KRW", name: "韩元" },
  { code: "HKD", name: "港元" },
  { code: "TWD", name: "新台币" },
  { code: "SGD", name: "新加坡元" },
  { code: "AUD", name: "澳大利亚元" },
  { code: "CAD", name: "加拿大元" },
  { code: "INR", name: "印度卢比" },
  { code: "BRL", name: "巴西雷亚尔" },
  { code: "IDR", name: "印度尼西亚盾" },
  { code: "THB", name: "泰铢" },
  { code: "VND", name: "越南盾" },
] as const;

const symbols = new Map<string, string>();

/**
 * The symbol written before an amount, such as ¥ or US$, or an empty string when the
 * Project has not chosen a currency. Codes without a symbol (SGD, THB) end with a space.
 */
export function currencyPrefix(code: string | undefined) {
  if (!code) return "";
  const cached = symbols.get(code);
  if (cached !== undefined) return cached;
  let symbol = code;
  try {
    symbol =
      new Intl.NumberFormat("zh-CN", { style: "currency", currency: code })
        .formatToParts(1)
        .find((part) => part.type === "currency")?.value ?? code;
  } catch {
    // An unknown code still reads as itself.
  }
  const prefix = /^[A-Za-z]+$/.test(symbol) ? `${symbol} ` : symbol;
  symbols.set(code, prefix);
  return prefix;
}
