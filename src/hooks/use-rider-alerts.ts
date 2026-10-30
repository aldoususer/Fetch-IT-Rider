'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceRiderAlerts, readRiderAlertState, type AlertSnapshot, type AlertState, type RiderAlert } from '@/lib/rider-alerts';
import { useVisiblePoll } from './use-visible-poll';
import { useToast } from './use-toast';

export function useRiderAlerts(userId: string) {
  const [items, setItems] = useState<RiderAlert[]>([]), [browserEnabled, setBrowserEnabled] = useState(false);
  const state = useRef<AlertState | null>(null), owner = useRef('');
  const { toast } = useToast();
  const key = 'fetchit:rider-alerts:v1:' + userId;
  const save = useCallback((next: AlertState) => {
    state.current = next; setItems(next.items);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Inbox still works for this session. */ }
  }, [key]);
  useEffect(() => {
    owner.current = userId; state.current = null;
    const restore = () => {
      try {
        const saved = readRiderAlertState(JSON.parse(localStorage.getItem(key) || 'null'));
        if (saved) {
          state.current = saved; setItems(saved.items);
        }
        setBrowserEnabled(localStorage.getItem(key + ':browser') === '1' && 'Notification' in window && Notification.permission === 'granted');
      } catch { /* A bad local cache must not block jobs. */ }
    };
    queueMicrotask(() => { if (owner.current === userId) { setItems([]); restore(); } });
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === key + ':browser') restore(); };
    window.addEventListener('storage', onStorage);
    return () => { owner.current = ''; window.removeEventListener('storage', onStorage); };
  }, [key, userId]);
  const connection = useVisiblePoll(userId ? userId + ':rider-alerts' : '', async signal => {
    const response = await fetch('/api/rider/updates', { cache: 'no-store', signal });
    const snapshot = await response.json() as AlertSnapshot;
    if (!response.ok || !Array.isArray(snapshot.available) || !Array.isArray(snapshot.assigned) || !Number.isFinite(Date.parse(snapshot.checkedAt))) throw new Error('Couldn’t update rider notifications.');
    if (signal.aborted || owner.current !== userId) return;
    // Re-read to honour another tab's baseline/read state before deduplicating.
    try { const saved = readRiderAlertState(JSON.parse(localStorage.getItem(key) || 'null')); if (saved && (!state.current || Date.parse(saved.checkedAt) >= Date.parse(state.current.checkedAt))) state.current = saved; } catch {}
    const result = advanceRiderAlerts(state.current, snapshot);
    save(result.state);
    if (result.added.length) {
      toast({ title: result.added.length > 1 ? `${result.added.length} rider updates` : result.added[0].title, description: result.added.map(item => item.refCode).join(' · ') });
      if (browserEnabled && Notification.permission === 'granted' && document.visibilityState === 'visible') {
        const item = result.added[0];
        // Optional local browser alerts; no claim of closed-app/background push.
        void navigator.serviceWorker?.getRegistration().then(registration => {
          if (owner.current === userId) return registration?.showNotification(item.title, { body: item.refCode + ' · ' + item.body, tag: item.id, icon: '/rider-icon-192.png', data: { bookingId: item.bookingId } });
        }).catch(() => {});
      }
    }
  }, 5000);
  function markRead(id?: string) { if (state.current) save({ ...state.current, items: state.current.items.map(item => !id || item.id === id ? { ...item, read: true } : item) }); }
  async function enableBrowser() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Browser alerts are unavailable here. Your notification inbox still works.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Allow notifications in your browser settings, or keep using the inbox.');
    localStorage.setItem(key + ':browser', '1'); setBrowserEnabled(true);
  }
  function disableBrowser() { try { localStorage.removeItem(key + ':browser'); } catch {} setBrowserEnabled(false); }
  return { items, unread: items.filter(item => !item.read).length, markRead, enableBrowser, disableBrowser, browserEnabled, connection };
}
