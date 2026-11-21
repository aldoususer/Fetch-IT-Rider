import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { savedMutation } from '@/lib/booking-mutation-client';
import { RIDE_DROPOFF_GRACE_MS } from '@/lib/rider-occupancy';
import type { RiderJob } from '@/lib/rider-workspace';

export function CustomerConfirmationChecklist({ job, disabled, onUpdated }: {
  job: RiderJob; disabled: boolean; onUpdated: (update: Partial<RiderJob>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function reportDropoff() {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const url = `/api/bookings/${encodeURIComponent(job.id)}`;
    try {
      const response = await fetch(`${url}/dropoff-report`, { method: 'POST', signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.booking?.riderDropoffReportedAt) throw new Error(data.error || 'Couldn’t save drop-off.');
      onUpdated(data.booking);
      setConfirming(false);
    } catch (failure) {
      const saved = await savedMutation<{ booking: RiderJob }>(url, data => data.booking?.id === job.id && !!data.booking.riderDropoffReportedAt);
      if (saved) {
        onUpdated(saved.booking);
        setConfirming(false);
      } else {
        setError(failure instanceof Error ? failure.message : 'Couldn’t save drop-off. Try again.');
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const pickup = !!job.customerPickupConfirmedAt, dropoff = !!job.customerDropoffConfirmedAt;
  const inTransit = job.status === 'IN_TRANSIT';
  return <section className="rd-confirmations" aria-label="Customer confirmations">
    <h3 className="font-semibold">Customer confirmations</h3>
    <ol className="rd-payment-progress">
      <li className={pickup ? 'is-done' : ''}><span aria-hidden="true">{pickup ? '✓' : '1'}</span><span>Customer confirmed boarding · {pickup ? 'Done' : 'Pending'}</span></li>
      {inTransit && <li className={dropoff ? 'is-done' : ''}><span aria-hidden="true">{dropoff ? '✓' : '2'}</span><span>Customer confirmed drop-off · {dropoff ? 'Done' : 'Pending'}</span></li>}
    </ol>
    {!pickup ? <p role="status">{inTransit ? 'This trip is already in progress, but the customer’s pickup confirmation is missing. ' : ''}Ask the customer to open their ride screen and confirm they’re on board. Pickup-code verification is a separate check.</p>
      : inTransit && !dropoff ? <p role="status">{job.riderDropoffReportedAt
        ? `Drop-off reported. The passenger’s confirmation is pending. You can accept another job after ${new Date(Date.parse(job.riderDropoffReportedAt) + RIDE_DROPOFF_GRACE_MS).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' })} PH time.`
        : 'At the destination, ask the customer to confirm arrival in their ride screen.'}</p>
      : <p role="status">{inTransit ? 'Both customer confirmations are saved.' : 'Customer pickup confirmation is saved. You can start the trip.'}</p>}
    {job.rideDropoffIssueReportedAt && <p role="status">The passenger sent a drop-off issue to support.</p>}
    {inTransit && pickup && !dropoff && !job.riderDropoffReportedAt && (confirming
      ? <div className="space-y-2">
          <p>Confirm that the passenger has exited the vehicle. They’ll be asked to confirm arrival or report an issue.</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>{' '}
          <Button type="button" disabled={disabled || busy} onClick={reportDropoff}>{busy ? 'Reporting…' : 'Report drop-off'}</Button>
        </div>
      : <Button type="button" variant="outline" disabled={disabled} onClick={() => setConfirming(true)}>Passenger can’t confirm</Button>)}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {(!pickup || (inTransit && !dropoff)) && <a href={`mailto:fetchitsupport@gmail.com?subject=${encodeURIComponent(`Ride confirmation help · ${job.refCode}`)}`}>Customer unable to confirm? Contact support</a>}
  </section>;
}
