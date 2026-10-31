'use client';
import { useAppStore } from './store';

async function response<T>(result: Response, fallback: string): Promise<T> {
  const data = await result.json().catch(() => null);
  if (!result.ok || !data) throw new Error(data?.error || fallback);
  return data as T;
}
async function worker() {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Notifications are getting ready. Please retry.')), 15000); })]); }
  finally { clearTimeout(timer); }
  return registration;
}
let accountVersion = 0;
export async function setRiderPushAccount(riderId: string | null) {
  const version = ++accountVersion;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (version !== accountVersion) return;
  const active = registration?.active ?? navigator.serviceWorker.controller;
  if (!active) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Notification settings are still updating. Please retry.')); }, 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data?.ok) resolve(); else reject(new Error('Couldn’t save notification settings.')); };
    active.postMessage({ type: 'RIDER_PUSH_ACCOUNT', riderId }, [channel.port2]);
  });
}
export async function riderPushState() {
  return response<{ publicKey: string; enabled: boolean }>(await fetch('/api/push/subscription', { cache: 'no-store' }), 'Couldn’t check background alerts.');
}
const pending = new Map<string, Promise<void>>();
export function ensureRiderPush(riderId: string) {
  const existing = pending.get(riderId); if (existing) return existing;
  const task = (async () => {
    const registration = await worker();
    if (useAppStore.getState().user?.id !== riderId) return;
    await setRiderPushAccount(riderId);
    const config = await riderPushState();
    const raw = atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
    const key = Uint8Array.from(raw, character => character.charCodeAt(0));
    if (useAppStore.getState().user?.id !== riderId) return;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription?.options.applicationServerKey) {
      const current = new Uint8Array(subscription.options.applicationServerKey);
      if (current.length !== key.length || !current.every((value, index) => value === key[index])) { await subscription.unsubscribe(); subscription = null; }
    }
    if (subscription && config.enabled) return;
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (useAppStore.getState().user?.id !== riderId) return;
    await response(await fetch('/api/push/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()) }), 'Couldn’t enable background alerts.');
  })().finally(() => pending.delete(riderId));
  pending.set(riderId, task); return task;
}
export async function enableRiderPush(riderId: string) {
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Background alerts are unavailable in this browser. On iPhone or iPad, add Fetch-It Rider to your Home Screen and open it there first.');
  // Called directly by the user's click, before any network request.
  if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in your browser settings to enable background alerts.');
  await ensureRiderPush(riderId);
}
export async function disableRiderPush() {
  await setRiderPushAccount(null);
  await response(await fetch('/api/push/subscription', { method: 'DELETE' }), 'Connect to turn off background alerts on this device.');
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}
