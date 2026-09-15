import { useId, type ComponentProps, type ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <header className="auth-toolbar">
        <div className="auth-brand">
          <BrandMark />
          <span>OpenRUM</span>
        </div>
        <ThemeToggle compact />
      </header>
      <main className="auth-body">
        <div className="auth-content">{children}</div>
      </main>
      <footer className="auth-footer">Open-source real user monitoring</footer>
    </div>
  );
}

export function AuthField({
  label,
  hint,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <Field
      className="auth-field"
      data-invalid={props["aria-invalid"]}
      data-disabled={props.disabled}
    >
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        className={cn("h-11", className)}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
    </Field>
  );
}
