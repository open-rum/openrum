import { createContext, useContext } from "react";

// Front-end preview data (user decision, 2026-11-11): development builds only, held in page
// state, never stored or shared. A page that offers it owns the switch and provides the
// state here, so nested parts (a detail drawer, its sample list) read the same choice.

/** Whether this build may offer preview data at all. */
export const MOCK_DATA_AVAILABLE = import.meta.env.DEV;

export const MockDataContext = createContext(false);

export function useMockData() {
  return useContext(MockDataContext);
}
