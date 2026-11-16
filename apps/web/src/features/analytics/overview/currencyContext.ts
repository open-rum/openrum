import { createContext, useContext } from "react";

/** The Project's revenue currency code, or an empty string when none was chosen. */
export const RevenueCurrencyContext = createContext("");

export function useRevenueCurrency() {
  return useContext(RevenueCurrencyContext);
}
