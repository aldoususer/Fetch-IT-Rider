'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { captureRiderLocation, type RiderFix } from '@/lib/rider-location-client';

export function GoOnlineDialog({ open, onOpenChange, enableNotifications, onReady, notificationsReady = false, isOnline = false, onGoOffline }: {
  open: boolean; onOpenChange: (open: boolean) => void; enableNotifications: () => Promise<void>; onReady: (fix: RiderFix) => Promise<void>; notificationsReady?: boolean;
  isOnline?: boolean; onGoOffline?: () => Promise<void>;
}) {
  const [pushReady, setPushReady] = useState(notificationsReady), [busy, setBusy] = useState<'push' | 'location' | 'online' | 'offline' | null>(null), [error, setError] = useState('');
  const lock = useRef(false), generation = useRef(0);
  const committing = busy === 'online' || busy === 'offline';
  useEffect(() => () => { generation.current++; }, []);
  async function notifications() {
    if (lock.current) return; lock.current = true; setBusy('push'); setError(''); const current = generation.current;
    try { await enableNotifications(); if (current === generation.current) setPushReady(true); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Enable notifications to receive job offers.'); }
    finally { if (current === generation.current) { lock.current = false; setBusy(null); } }
  }
  async function location() {
    if (lock.current || !pushReady) return; lock.current = true; setBusy('location'); setError(''); const current = generation.current;
    try { const fix = await captureRiderLocation(); if (current !== generation.current) return; setBusy('online'); await onReady(fix); if (current === generation.current) onOpenChange(false); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Couldn’t go online. Retry when connected.'); }
    finally { if (current === generation.current) { lock.current = false; setBusy(null); } }
  }
  async function goOffline() {
    if (lock.current || !onGoOffline) return;
    lock.current = true; setBusy('offline'); setError(''); const current = generation.current;
    try { await onGoOffline(); if (current === generation.current) onOpenChange(false); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Couldn’t go offline. Reconnect and retry.'); }
    finally { if (current === generation.current) { lock.current = false; setBusy(null); } }
  }
  return <Dialog open={open} onOpenChange={value => { if (!committing) onOpenChange(value); }}><DialogContent className="rd-online-dialog" showCloseButton={!committing} onInteractOutside={event => { if (committing) event.preventDefault(); }} onEscapeKeyDown={event => { if (committing) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{isOnline ? 'Resume receiving jobs' : 'Get ready to receive jobs'}</DialogTitle><DialogDescription>{isOnline ? 'New offers are paused until notifications and location are ready.' : 'Notifications and a fresh location are required to go online.'}</DialogDescription></DialogHeader>
    <p className="rd-setup-step" role="status">Step {pushReady ? '2' : '1'} of 2{pushReady && <span><CheckCircle2 size={16} aria-hidden="true"/> Notifications ready</span>}</p>
    <div className="rd-online-current">{pushReady ? <MapPin size={24} aria-hidden="true"/> : <Bell size={24} aria-hidden="true"/>}<div><h3>{pushReady ? 'Share your location' : 'Enable job notifications'}</h3><p>{pushReady ? 'Find nearby pickups. During a job, your location is shared with your customer.' : 'Receive job offers when you switch apps. Your browser may ask for permission.'}</p></div></div>
    {error && <p className="rd-notice" role="alert">{error}</p>}
    <details className="rd-setup-help"><summary>Need help with permissions?</summary><p>Allow notifications and location in this site’s browser settings. On iPhone, add Rider to your Home Screen and open it there.</p><p>Background GPS can pause. Offers pause when your saved location is too old.</p></details>
    <div className="rd-online-actions">{isOnline && onGoOffline ? <Button variant="outline" disabled={!!busy} onClick={() => void goOffline()}>{busy === 'offline' ? 'Going offline…' : 'Go offline'}</Button> : <Button variant="outline" disabled={committing} onClick={() => onOpenChange(false)}>Not now</Button>}{!pushReady ? <Button disabled={!!busy} onClick={() => void notifications()}>{busy === 'push' && <Loader2 className="animate-spin" size={18} aria-hidden="true"/>}{busy === 'push' ? 'Enabling notifications…' : 'Enable notifications'}</Button> : <Button disabled={!!busy} onClick={() => void location()}>{(busy === 'location' || busy === 'online') && <Loader2 className="animate-spin" size={18} aria-hidden="true"/>}{busy === 'online' ? 'Updating availability…' : busy === 'location' ? 'Finding your location…' : isOnline ? 'Refresh location & resume' : 'Enable location & go online'}</Button>}</div>
  </DialogContent></Dialog>;
}
