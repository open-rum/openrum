import * as React from "react";

import { cn } from "@/lib/utils";

/** daisyUI's `input`; `aria-invalid` turns it to `input-error`. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("input w-full min-w-0 aria-invalid:input-error", className)}
      {...props}
    />
  );
}

export { Input };
