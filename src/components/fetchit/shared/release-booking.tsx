'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cancellationReasons, type CancellationSummary } from '@/lib/rider-cancellation-policy';

export function ReleaseBooking({ id, onReleased, disabled = false, onActionFailure }: { id: string; onReleased: () => void; disabled?: boolean; onActionFailure?: () => void }) {
  const pending = useRef(false), { toast } = useToast();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [reasonCode, setReasonCode] = useState(''), [error, setError] = useState('');
  const choice = cancellationReasons.find(item => item.code === reasonCode);
  return <><Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Cancel this job</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }}><DialogContent><DialogHeader>
      <DialogTitle>Cancel your assignment?</DialogTitle><DialogDescription>The customer’s booking stays open while we look for another rider. Available only before pickup and before cash payment is recorded.</DialogDescription>
    </DialogHeader><form className="space-y-3" onSubmit={async event => {
      event.preventDefault(); if (pending.current || disabled || !choice || !reason.trim()) return;
      pending.current = true; setBusy(true); setError('');
      try {
        const response = await fetch(`/api/bookings/${id}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, reasonCode }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Couldn’t confirm cancellation. Refresh the job to check its status.');
        const summary = data?.cancellation as CancellationSummary | undefined;
        toast({ title: 'Your assignment ended', description: summary?.message ?? 'We’re finding another rider for the customer.' });
        setOpen(false); onReleased();
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Cancellation unavailable.'); onActionFailure?.(); }
      finally { pending.current = false; setBusy(false); }
    }}>
      <label className="block text-sm">Reason<select className="mt-2 w-full min-h-12 rounded-md border bg-background p-3 text-base" required disabled={busy} value={reasonCode} onChange={event => setReasonCode(event.target.value)}><option value="">Choose a reason</option>{cancellationReasons.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      {choice && <p className="text-sm text-muted-foreground">{choice.code === 'PASSENGER_NO_SHOW' ? 'Requires recorded arrival, a 5-minute wait and a fresh location within 150 m of pickup.' : choice.exempt ? 'Excluded from automatic penalties. Your report is recorded for review.' : 'Counts toward today’s cancellations. At least 4 and a cancellation rate of 20% or higher pauses new offers for 15 minutes.'}</p>}
      <label className="block text-sm">What happened?<textarea className="mt-2 w-full rounded-md border bg-background p-3 text-base" required maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)}/></label>
      <p className="text-xs text-muted-foreground">Daily warnings reset at midnight, Philippine time. Safety and emergencies never require you to continue a job.</p>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button className="min-h-12" type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep job</Button><Button className="min-h-12" type="submit" disabled={busy || disabled || !choice || !reason.trim()}>{busy ? 'Cancelling…' : 'Cancel job'}</Button></div>
    </form></DialogContent></Dialog>
  </>;
}
