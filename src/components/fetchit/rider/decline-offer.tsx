'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// Keep the authenticated release endpoint and its locked ownership checks.
export function DeclineOffer({ id, disabled, onDeclined, onBusyChange }: {
  id: string; disabled?: boolean; onDeclined: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function decline() {
    if (disabled || pending.current) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(id)}/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rider declined the unaccepted offer.', offerOnly: true }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Couldn’t decline this offer. Refresh jobs and try again.');
      onDeclined();
    } catch (failure) { setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'Decline could not be confirmed. Refresh jobs to check the offer.'); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  return <><Button variant="outline" disabled={disabled || busy} onClick={() => void decline()}>{busy ? 'Declining offer…' : 'Decline offer'}</Button>{error && <p className="rd-help text-destructive" role="alert">{error}</p>}</>;
}
