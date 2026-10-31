'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceRiderAlerts, readRiderAlertState, mergeRiderInbox, riderAlertIdentity, type AlertSnapshot, type AlertState, type RiderAlert } from '@/lib/rider-alerts';
import { enableRiderPush, disableRiderPush, ensureRiderPush, riderPushState } from '@/lib/rider-push';
import { useVisiblePoll } from './use-visible-poll';
import { useToast } from './use-toast';

export function useRiderAlerts(userId: string) {
  const [items, setItems] = useState<RiderAlert[]>([]), [browserEnabled, setBrowserEnabled] = useState(false);
  const state = useRef<AlertState | null>(null), owner = useRef('');
  const settingsLock = useRef(false);
  const [settingsBusy, setSettingsBusy] = useState(false), [settingsLoading, setSettingsLoading] = useState(true);
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
      } catch { /* A bad local cache must not block jobs. */ }
    };
    queueMicrotask(() => { if (owner.current === userId) { setItems([]); restore(); } });
    const onStorage = (event: StorageEvent) => { if (event.key === key) restore(); };
    window.addEventListener('storage', onStorage);
    return () => { owner.current = ''; window.removeEventListener('storage', onStorage); };
  }, [key, userId]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await riderPushState();
        const granted = 'Notification' in window && Notification.permission === 'granted';
        if (cancelled) return;
        setBrowserEnabled(config.enabled && granted);
        if (config.enabled && granted) await ensureRiderPush(userId);
      } catch { /* Inbox remains usable if device settings are unavailable. */ }
      finally { if (!cancelled) setSettingsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  const connection = useVisiblePoll(userId ? userId + ':rider-alerts' : '', async signal => {
    const response = await fetch('/api/rider/updates', { cache: 'no-store', signal });
    const snapshot = await response.json() as AlertSnapshot;
    if (!response.ok || !Array.isArray(snapshot.available) || !Array.isArray(snapshot.assigned) || !Number.isFinite(Date.parse(snapshot.checkedAt))) throw new Error('Couldn’t update rider notifications.');
    if (signal.aborted || owner.current !== userId) return;
    // Re-read to honour another tab's baseline/read state before deduplicating.
    try { const saved = readRiderAlertState(JSON.parse(localStorage.getItem(key) || 'null')); if (saved && (!state.current || Date.parse(saved.checkedAt) >= Date.parse(state.current.checkedAt))) state.current = saved; } catch {}
    const previous = state.current;
    const result = advanceRiderAlerts(previous, snapshot), server = snapshot.notifications ?? [];
    const merged = mergeRiderInbox(result.state.items, server), serverKinds = new Set(server.map(riderAlertIdentity));
    const fresh = [...result.added.filter(item => !serverKinds.has(riderAlertIdentity(item))), ...server.filter(item => previous && !previous.seen.includes(item.id) && !item.read && Date.parse(item.createdAt) >= Date.parse(previous.startedAt))];
    save({ ...result.state, items: merged.items, seen: [...new Set([...result.state.seen, ...server.map(item => item.id)])].slice(-600) });
    if (merged.acknowledge.length) await saveServerRead(merged.acknowledge, signal);
    // Background subscriptions show an OS notification. Keep one alert surface
    // for those events; local scheduled reminders still use the in-app toast.
    const toastItems = fresh.filter(item => !browserEnabled || !['new','cancelled','offered'].includes(item.kind ?? ''));
    if (toastItems.length) toast({ title: toastItems.length > 1 ? `${toastItems.length} rider updates` : toastItems[0].title, description: toastItems.map(item => item.refCode).join(' · ') });
  }, 5000);
  async function saveServerRead(ids: string[], signal?: AbortSignal) {
    if (!ids.length) return;
    const response = await fetch('/api/rider/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), signal: signal ?? AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Couldn’t mark notifications as read. Please retry when connected.');
  }
  async function markRead(id?: string) {
    if (!state.current) return;
    const ids = state.current.items.filter(item => !id || item.id === id).flatMap(item => item.serverId ? [item.serverId] : []);
    await saveServerRead(ids);
    if (owner.current === userId && state.current) save({ ...state.current, items: state.current.items.map(item => !id || item.id === id ? { ...item, read: true } : item) });
  }
  async function enableBrowser() {
    if (settingsLock.current) return; settingsLock.current = true; setSettingsBusy(true);
    try { await enableRiderPush(userId); if (owner.current === userId) setBrowserEnabled(true); }
    finally { settingsLock.current = false; setSettingsBusy(false); }
  }
  async function disableBrowser() {
    if (settingsLock.current) return; settingsLock.current = true; setSettingsBusy(true);
    try { await disableRiderPush(); if (owner.current === userId) setBrowserEnabled(false); }
    finally { settingsLock.current = false; setSettingsBusy(false); }
  }
  return { items, unread: items.filter(item => !item.read).length, markRead, enableBrowser, disableBrowser, browserEnabled, settingsBusy, settingsLoading, connection };
}
