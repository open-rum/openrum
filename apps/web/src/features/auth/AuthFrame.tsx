import type { ReactNode } from "react";
import { ChartLineUp, ShieldCheck } from "@phosphor-icons/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen bg-background lg:grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="relative hidden overflow-hidden border-r border-border bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between dark:bg-black">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,91,255,0.34),transparent_34%),radial-gradient(circle_at_85%_82%,rgba(49,130,246,0.18),transparent_32%)]" />
        <div className="relative flex items-center gap-3 text-lg font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-lg bg-[#635bff]">
            <ChartLineUp className="size-5" weight="bold" />
          </span>
          OpenRUM
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl leading-tight font-semibold tracking-[-0.035em]">
            把前端质量数据，变成可以立即行动的证据。
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300">
            在一个平台中分析真实用户行为、错误、Core Web Vitals、API 请求与自定义事件。
          </p>
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-300">
            <ShieldCheck className="size-5 text-emerald-400" weight="fill" />
            自部署 · 数据自持有 · 无隐藏采样
          </div>
        </div>
        <p className="relative text-xs text-slate-500">OpenRUM Community Edition</p>
      </section>

      <section className="relative flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}

export function AuthField({
  label,
  hint,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-foreground">
      <span className="flex items-baseline justify-between gap-4">
        {label}
        {hint ? <small className="text-xs font-normal text-muted-foreground">{hint}</small> : null}
      </span>
      <input
        className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-60"
        {...props}
      />
    </label>
  );
}
