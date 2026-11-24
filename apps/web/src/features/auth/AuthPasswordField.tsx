import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function AuthPasswordField({
  label,
  hint,
  footer,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  label: string;
  hint?: string;
  footer?: ReactNode;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const [visible, setVisible] = useState(false);

  return (
    <Field
      className="auth-field"
      data-invalid={props["aria-invalid"]}
      data-disabled={props.disabled}
    >
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <InputGroup className="h-11 bg-base-100">
        <InputGroupInput
          id={inputId}
          type={visible ? "text" : "password"}
          className={className}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(" ") || undefined}
          {...props}
        />
        <InputGroupAddon align="inline-end" className="pr-1.5">
          <InputGroupButton
            size="icon-sm"
            aria-label={visible ? `隐藏${label}` : `显示${label}`}
            aria-pressed={visible}
            disabled={props.disabled}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? (
              <EyeOffIcon className="size-4" aria-hidden="true" />
            ) : (
              <EyeIcon className="size-4" aria-hidden="true" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {footer}
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
    </Field>
  );
}
