export { cva, type VariantProps } from "class-variance-authority";
export { clsx, type ClassValue } from "clsx";
export { twMerge } from "tailwind-merge";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
