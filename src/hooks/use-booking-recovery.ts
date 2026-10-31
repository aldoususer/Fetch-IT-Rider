'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RiderJob } from '@/lib/rider-workspace';

// Read before resuming writes after a lost connection or an ambiguous response.
// Never replay a mutation and never remount the form that owns unsaved input.
export function useBookingRecovery(bookingId: string, onBooking: (booking: RiderJob) => void, connectionReady: boolean) {
  const [state, setState] = useState({ ready: false, error: '' });
  const callback = useRef(onBooking), alive = useRef(false), request = useRef<AbortController | null>(null), version = useRef(0);
  useEffect(() => { callback.current = onBooking; }, [onBooking]);
  const check = useCallback(async () => {
    if (!alive.current || request.current) return;
    if (!connectionReady || !navigator.onLine) { setState({ ready: false, error: 'Reconnect to check the latest booking. Your entered details are kept.' }); return; }
    const current = ++version.current, controller = new AbortController(); request.current = controller;
    setState({ ready: false, error: '' });
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/bookings/' + encodeURIComponent(bookingId), { cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.booking || data.booking.id !== bookingId) throw new Error(data?.error || 'Couldn’t verify this booking. Retry before making another update.');
      if (controller.signal.aborted) throw new Error('The booking check timed out. Retry when connected.');
      if (!alive.current || current !== version.current) return;
      callback.current(data.booking); setState({ ready: true, error: '' });
    } catch (reason) {
      if (alive.current && current === version.current) setState({ ready: false, error: controller.signal.aborted ? 'The booking check timed out. Your entered details are kept. Retry when connected.' : reason instanceof Error ? reason.message : 'Couldn’t check the latest booking.' });
    } finally { clearTimeout(timer); if (request.current === controller) request.current = null; }
  }, [bookingId, connectionReady]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => { if (alive.current) void check(); });
    const resume = () => { if (document.visibilityState !== 'hidden') void check(); };
    const offline = () => { version.current++; request.current?.abort(); request.current = null; setState({ ready: false, error: 'You’re offline. Your entered details are kept; reconnect to check the latest booking.' }); };
    window.addEventListener('online', resume); window.addEventListener('offline', offline); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { alive.current = false; version.current++; request.current?.abort(); request.current = null; window.removeEventListener('online', resume); window.removeEventListener('offline', offline); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [check]);
  return { ready: state.ready && connectionReady, error: state.error, recheck: check };
}
