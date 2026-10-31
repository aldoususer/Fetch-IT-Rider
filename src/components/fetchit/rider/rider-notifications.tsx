'use client';
import { useRef, useState } from 'react';
import { Bell, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { useRiderAlerts } from '@/hooks/use-rider-alerts';
import type { RiderAlert } from '@/lib/rider-alerts';

export function RiderNotifications({ alerts, onOpen }: { alerts: ReturnType<typeof useRiderAlerts>; onOpen: (item: RiderAlert) => Promise<void> }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <>
    <Button size="icon" variant="outline" className="rd-notification-bell" aria-label={`Notifications${alerts.unread ? `, ${alerts.unread} unread` : ''}`} onClick={() => setOpen(true)}><Bell size={19}/>{alerts.unread > 0 && <span>{alerts.unread > 99 ? '99+' : alerts.unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent fullScreenOnMobile className="rd-alert-dialog"><DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Your latest job updates.</DialogDescription></DialogHeader>
      <div className="rd-alert-toolbar"><Button size="sm" variant="outline" disabled={!alerts.unread || busy} onClick={async () => { setError(''); try { await alerts.markRead(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Couldn’t mark notifications as read.'); } }}>Mark all as read</Button><Button size="sm" variant="ghost" aria-expanded={settingsOpen} aria-controls="rider-notification-settings" onClick={()=>setSettingsOpen(value=>!value)}><Settings size={18}/>Settings</Button></div>
      {settingsOpen && <section id="rider-notification-settings" className="rd-alert-settings" aria-label="Notification settings"><h3>Background alerts</h3><p>{alerts.browserEnabled ? 'On for this device.' : 'Off for this device.'} Receive new-job and cancellation alerts when Rider is closed. Go Online to receive new jobs.</p><Button variant="outline" disabled={alerts.settingsBusy || alerts.settingsLoading} onClick={async () => {
        setError(''); try { if (alerts.browserEnabled) await alerts.disableBrowser(); else await alerts.enableBrowser(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Couldn’t update background alerts.'); }
      }}>{alerts.settingsLoading ? 'Checking alerts…' : alerts.settingsBusy ? 'Updating…' : alerts.browserEnabled ? 'Turn off background alerts' : 'Enable background alerts'}</Button><details><summary>Device and scheduled reminders</summary><p>On iPhone or iPad, add Rider to your Home Screen and open it there before enabling alerts. Scheduled reminders update while the app is open.</p></details></section>}
      {['offline', 'reconnecting'].includes(alerts.connection.status) && <p role="status">Reconnecting… Saved notifications remain available.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && <p role="status" className="text-sm">Opening booking…</p>}
      <div className="rd-alert-list">{!alerts.items.length ? <p className="rd-help">You’re all caught up.</p> : alerts.items.map(item => <button key={item.id} disabled={busy} className={`rd-alert-item ${item.read ? '' : 'is-unread'}`} onClick={async () => {
        if (pending.current) return; pending.current = true; setBusy(true); setError('');
        try { await onOpen(item); await alerts.markRead(item.id); setOpen(false); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t open this booking.'); } finally { pending.current = false; setBusy(false); }
      }}><strong>{item.title}{!item.read && <span aria-label="Unread"> ●</span>}</strong><span>{item.refCode} · {item.body}</span><small>{new Date(item.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} · PH time</small></button>)}</div>
    </DialogContent></Dialog>
  </>;
}
