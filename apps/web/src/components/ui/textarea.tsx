import * as React from "react";
import { cn } from "@/lib/utils";

/** daisyUI's `textarea`, growing with its content. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "textarea field-sizing-content min-h-24 w-full aria-invalid:textarea-error",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
