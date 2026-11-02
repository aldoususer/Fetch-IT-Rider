"use client";

// A lost response is not a failed write. Reconcile with a fresh read, never
// automatically send the mutation again. Callers keep their draft on failure.
export async function savedMutation<T>(url: string, isSaved: (state: T) => boolean): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const state = await response.json() as T;
    return isSaved(state) ? state : null;
  } catch { return null; }
}
