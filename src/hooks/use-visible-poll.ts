"use client";
import { useEffect, useRef, useState } from "react";

// Use the latest callback without restarting the timer on every render.
export function useVisiblePoll(key: string, poll: (signal: AbortSignal) => Promise<void | number>, intervalMs = 3000, immediate = true) {
  const callback = useRef(poll);
  const [connection, setConnection] = useState<{status: 'checking' | 'connected' | 'reconnecting' | 'offline'; lastSuccessAt: number | null}>({status: 'checking', lastSuccessAt: null});
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
        if (controller.signal.aborted) throw new Error('Update timed out');
        if (!stopped) setConnection({status: 'connected', lastSuccessAt: Date.now()});
        failures = 0;
        nextAllowedAt = typeof delay === "number" ? Date.now() + Math.max(intervalMs, delay) : 0;
      }
      catch {
        if (!stopped) setConnection(previous => ({...previous, status: navigator.onLine ? 'reconnecting' : 'offline'}));
        failures++;
        nextAllowedAt = Date.now() + Math.min(15000, intervalMs * 2 ** Math.min(failures, 3));
      }
      finally { clearTimeout(deadline); running = false; }
    };
    if (immediate) void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    const resume = () => { nextAllowedAt = 0; void refresh(); };
    const offline = () => { controller?.abort(); setConnection(previous => ({...previous, status: 'offline'})); };
    if (!navigator.onLine) offline();
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", resume);
    window.addEventListener("fetchit:rider-push", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", resume);
      window.removeEventListener("fetchit:rider-push", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [key, intervalMs, immediate]);
  return connection;
}
