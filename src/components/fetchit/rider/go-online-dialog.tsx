'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { captureRiderLocation, type RiderFix } from '@/lib/rider-location-client';

export function GoOnlineDialog({ open, onOpenChange, enableNotifications, onReady, notificationsReady = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; enableNotifications: () => Promise<void>; onReady: (fix: RiderFix) => Promise<void>; notificationsReady?: boolean;
}) {
  const [pushReady, setPushReady] = useState(notificationsReady), [busy, setBusy] = useState<'push' | 'location' | 'online' | null>(null), [error, setError] = useState('');
  const lock = useRef(false), generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function notifications() {
    if (lock.current) return; lock.current = true; setBusy('push'); setError(''); const current = generation.current;
    try { await enableNotifications(); if (current === generation.current) setPushReady(true); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Enable notifications to receive job offers.'); }
    finally { lock.current = false; setBusy(null); }
  }
  async function location() {
    if (lock.current || !pushReady) return; lock.current = true; setBusy('location'); setError(''); const current = generation.current;
    try { const fix = await captureRiderLocation(); if (current !== generation.current) return; setBusy('online'); await onReady(fix); if (current === generation.current) onOpenChange(false); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Couldn’t go online. Retry when connected.'); }
    finally { lock.current = false; setBusy(null); }
  }
  return <Dialog open={open} onOpenChange={value => { if (busy !== 'online') onOpenChange(value); }}><DialogContent className="rd-online-dialog" onInteractOutside={event => { if (busy === 'online') event.preventDefault(); }} onEscapeKeyDown={event => { if (busy === 'online') event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Get ready to receive jobs</DialogTitle><DialogDescription>Enable notifications and share your location to go online. You stay offline until both are ready.</DialogDescription></DialogHeader>
    <ol className="rd-online-steps"><li><Bell size={22} aria-hidden="true"/><div><h3>Enable job notifications</h3><p>Receive offers when you switch apps. Your browser will ask for permission if needed.</p></div>{pushReady && <CheckCircle2 aria-label="Notifications ready"/>}</li><li><MapPin size={22} aria-hidden="true"/><div><h3>Share your location to go online</h3><p>We use your recent location to find nearby pickups. During a job, it is shared with your customer.</p></div></li></ol>
    {error && <p className="rd-notice" role="alert">{error}</p>}
    <p className="rd-help">If permission is blocked, allow it in your browser’s site settings. On iPhone, open Rider from your Home Screen. Background GPS can pause; offers pause when your saved location is too old.</p>
    <div className="rd-online-actions"><Button variant="outline" disabled={busy === 'online'} onClick={() => onOpenChange(false)}>Stay offline</Button>{!pushReady ? <Button disabled={!!busy} onClick={() => void notifications()}>{busy && <Loader2 className="animate-spin" size={18}/>} {busy === 'push' ? 'Enabling notifications…' : 'Enable notifications'}</Button> : <Button disabled={!!busy} onClick={() => void location()}>{busy && <Loader2 className="animate-spin" size={18}/>} {busy === 'online' ? 'Going online…' : busy === 'location' ? 'Finding your location…' : 'Enable location & go online'}</Button>}</div>
  </DialogContent></Dialog>;
}
