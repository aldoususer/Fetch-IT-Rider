"use client";
import { useEffect, useRef } from "react";

// Use the latest callback without restarting the timer on every render.
export function useVisiblePoll(key: string, poll: (signal: AbortSignal) => Promise<void | number>, intervalMs = 3000) {
  const callback = useRef(poll);
  useEffect(() => { callback.current = poll; }, [poll]);
  useEffect(() => {
    if (!key) return;
    let running = false;
    let stopped = false;
    let failures = 0;
    let nextAllowedAt = 0;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (stopped || running || Date.now() < nextAllowedAt || document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 10000);
      try {
        const delay = await callback.current(controller.signal);
        failures = 0;
        nextAllowedAt = typeof delay === "number" ? Date.now() + Math.max(intervalMs, delay) : 0;
      }
      catch {
        failures++;
        nextAllowedAt = Date.now() + Math.min(60000, intervalMs * 2 ** Math.min(failures, 5));
      }
      finally { clearTimeout(deadline); running = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    const resume = () => { nextAllowedAt = 0; void refresh(); };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [key, intervalMs]);
}
