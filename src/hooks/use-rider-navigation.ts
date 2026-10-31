'use client';
import { useCallback, useEffect, useRef } from 'react';

export type RiderTab = 'available' | 'active' | 'history';
export type RiderNavigation = { tab: RiderTab; jobId: string | null; scrollY: number; detailEntry?: boolean };
const validTab = (value: unknown): value is RiderTab => ['available', 'active', 'history'].includes(String(value));

// Keep job details in browser history so device Back closes the job first.
// Only view preferences are stored; booking content and form inputs stay private.
export function useRiderNavigation(owner: string, onNavigate: (state: RiderNavigation) => void, canLeave: () => boolean) {
  const current = useRef<RiderNavigation>({ tab: 'available', jobId: null, scrollY: 0 });
  const callbacks = useRef({ onNavigate, canLeave });
  const scrolls = useRef<Partial<Record<RiderTab, number>>>({});
  useEffect(() => { callbacks.current = { onNavigate, canLeave }; }, [onNavigate, canLeave]);
  const commit = useCallback((next: RiderNavigation, replace = false, notify = true) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next.tab);
    if (next.jobId) url.searchParams.set('job', next.jobId); else url.searchParams.delete('job');
    const state = { ...window.history.state, fetchitRider: { ...next, owner } };
    window.history[replace ? 'replaceState' : 'pushState'](state, '', url);
    current.current = next;
    try { sessionStorage.setItem('fetchit:rider-view:' + owner, JSON.stringify({ tab: next.tab, scrolls: scrolls.current })); } catch {}
    if (notify) callbacks.current.onNavigate(next);
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    const url = new URL(window.location.href);
    let saved: { tab?: unknown; scrolls?: Partial<Record<RiderTab, number>> } = {};
    try { saved = JSON.parse(sessionStorage.getItem('fetchit:rider-view:' + owner) || '{}'); } catch {}
    for (const tab of ['available', 'active', 'history'] as const) {
      const value = saved?.scrolls?.[tab]; if (typeof value === 'number' && Number.isFinite(value)) scrolls.current[tab] = Math.max(0, value);
    }
    const tab = validTab(url.searchParams.get('tab')) ? url.searchParams.get('tab') as RiderTab : validTab(saved?.tab) ? saved.tab : 'available';
    const job = url.searchParams.get('job');
    commit({ tab, jobId: null, scrollY: scrolls.current[tab] ?? 0 }, true);
    if (job && job.length <= 100) commit({ tab, jobId: job, scrollY: 0, detailEntry: true });
    const pop = (event: PopStateEvent) => {
      const value = event.state?.fetchitRider;
      if (!callbacks.current.canLeave()) { commit(current.current, false, false); return; }
      const next: RiderNavigation = value?.owner === owner && validTab(value.tab)
        ? { tab: value.tab, jobId: typeof value.jobId === 'string' ? value.jobId : null, scrollY: Number.isFinite(value.scrollY) ? value.scrollY : 0, detailEntry: !!value.detailEntry }
        : { tab: 'available', jobId: null, scrollY: 0 };
      current.current = next; callbacks.current.onNavigate(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [owner, commit]);
  const navigate = useCallback((tab: RiderTab, jobId: string | null = null, replace = false) => {
    const previous = current.current;
    if (previous.jobId !== jobId && !callbacks.current.canLeave()) return;
    if (!previous.jobId) {
      scrolls.current[previous.tab] = window.scrollY;
      window.history.replaceState({ ...window.history.state, fetchitRider: { ...previous, owner, scrollY: window.scrollY } }, '');
    }
    commit({ tab, jobId, scrollY: jobId ? 0 : scrolls.current[tab] ?? 0, detailEntry: !!jobId }, replace);
  }, [owner, commit]);
  const close = useCallback(() => {
    if (!callbacks.current.canLeave()) return;
    if (current.current.detailEntry) window.history.back();
    else commit({ tab: current.current.tab, jobId: null, scrollY: scrolls.current[current.current.tab] ?? 0 }, true);
  }, [commit]);
  return { navigate, close };
}
