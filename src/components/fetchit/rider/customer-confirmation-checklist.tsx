import type { RiderJob } from '@/lib/rider-workspace';

export function CustomerConfirmationChecklist({ job }: { job: RiderJob }) {
  const pickup = !!job.customerPickupConfirmedAt, dropoff = !!job.customerDropoffConfirmedAt;
  const inTransit = job.status === 'IN_TRANSIT';
  return <section className="rd-confirmations" aria-label="Customer confirmations">
    <h3 className="font-semibold">Customer confirmations</h3>
    <ol className="rd-payment-progress">
      <li className={pickup ? 'is-done' : ''}><span aria-hidden="true">{pickup ? '✓' : '1'}</span><span>Customer confirmed boarding · {pickup ? 'Done' : 'Pending'}</span></li>
      {inTransit && <li className={dropoff ? 'is-done' : ''}><span aria-hidden="true">{dropoff ? '✓' : '2'}</span><span>Customer confirmed drop-off · {dropoff ? 'Done' : 'Pending'}</span></li>}
    </ol>
    {!pickup ? <p role="status">{inTransit ? 'This trip is already in progress, but the customer’s pickup confirmation is missing. ' : ''}Ask the customer to open their ride screen and confirm they’re on board. Pickup-code verification is a separate check.</p>
      : inTransit && !dropoff ? <p role="status">At the destination, ask the customer to confirm arrival in their ride screen.</p>
      : <p role="status">{inTransit ? 'Both customer confirmations are saved.' : 'Customer pickup confirmation is saved. You can start the trip.'}</p>}
    {(!pickup || (inTransit && !dropoff)) && <a href={`mailto:fetchitsupport@gmail.com?subject=${encodeURIComponent(`Ride confirmation help · ${job.refCode}`)}`}>Customer unable to confirm? Contact support</a>}
  </section>;
}
