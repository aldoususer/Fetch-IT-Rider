'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RiderJob } from '@/lib/rider-workspace';
import { removeProofDraft } from '@/lib/proof-drafts';
import { useAppStore } from '@/lib/store';

// Read before resuming writes after a lost connection or an ambiguous response.
// Never replay a mutation and never remount the form that owns unsaved input.
export function useBookingRecovery(bookingId: string, onBooking: (booking: RiderJob) => void, connectionReady: boolean) {
  const [state, setState] = useState({ ready: false, error: '', confirmedAt: 0 });
  const callback = useRef(onBooking), alive = useRef(false), request = useRef<AbortController | null>(null), version = useRef(0);
  useEffect(() => { callback.current = onBooking; }, [onBooking]);
  const check = useCallback(async () => {
    if (!alive.current || request.current) return;
    if (!connectionReady || !navigator.onLine) { setState(previous => ({ ...previous, ready: false, error: 'Reconnect to check the latest booking. Your entered details are kept on this page.' })); return; }
    const current = ++version.current, controller = new AbortController(); request.current = controller;
    setState(previous => ({ ...previous, ready: false, error: '' }));
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/bookings/' + encodeURIComponent(bookingId), { cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!alive.current || current !== version.current) return;
      if (controller.signal.aborted) throw new Error('The booking check timed out. Retry when connected.');
      if ([403, 404].includes(response.status)) { const ownerId = useAppStore.getState().user?.id; if (ownerId) void removeProofDraft(ownerId, bookingId).catch(() => {}); }
      if (!response.ok || !data?.booking || data.booking.id !== bookingId) throw new Error(data?.error || 'Couldn’t verify this booking. Retry before making another update.');
      callback.current(data.booking); setState({ ready: true, error: '', confirmedAt: Date.now() });
    } catch (reason) {
      if (alive.current && current === version.current) setState(previous => ({ ...previous, ready: false, error: controller.signal.aborted ? 'The booking check timed out. Your entered details are kept on this page. Retry when connected.' : reason instanceof Error ? reason.message : 'Couldn’t check the latest booking.' }));
    } finally { clearTimeout(timer); if (request.current === controller) request.current = null; }
  }, [bookingId, connectionReady]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => { if (alive.current) void check(); });
    const resume = () => { if (document.visibilityState !== 'hidden') void check(); };
    const offline = () => { version.current++; request.current?.abort(); request.current = null; setState(previous => ({ ...previous, ready: false, error: 'You’re offline. Reconnect to check the latest booking before submitting an update.' })); };
    window.addEventListener('online', resume); window.addEventListener('offline', offline); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { alive.current = false; version.current++; request.current?.abort(); request.current = null; window.removeEventListener('online', resume); window.removeEventListener('offline', offline); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [check]);
  return { ready: state.ready && connectionReady, error: state.error, confirmedAt: state.confirmedAt, recheck: check };
}
