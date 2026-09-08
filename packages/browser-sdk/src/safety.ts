export interface Diagnostics {
  internalErrors: number;
  droppedEvents: number;
  droppedAttributes: number;
  droppedBreadcrumbs: number;
  /**
   * Counted apart from droppedEvents because these were not lost: the project
   * asked for them to go, and the consumer would have removed them anyway.
   */
  filteredEvents: number;
}

export function runSafely<T>(diagnostics: Diagnostics, fallback: T, operation: () => T): T {
  try {
    return operation();
  } catch {
    diagnostics.internalErrors += 1;
    return fallback;
  }
}

export async function runSafelyAsync(
  diagnostics: Diagnostics,
  operation: () => void | Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch {
    diagnostics.internalErrors += 1;
  }
}
