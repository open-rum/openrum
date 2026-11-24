import { createContext, useContext } from "react";
import type { Project } from "@/lib/api/projects";

export type DevDataDialogRequest = { project: Project; sequence: number };
export const DevDataDialogContext = createContext<((project: Project) => void) | undefined>(
  undefined,
);
export function useDevDataDialog() {
  return useContext(DevDataDialogContext);
}
