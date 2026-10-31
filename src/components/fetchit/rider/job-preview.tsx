"use client";
import { useRef, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatJobTime, isUpcomingJob, jobTiming, type RiderJob } from '@/lib/rider-workspace';
import { demoSplit, isDemoPayment } from '@/lib/payment-policy';
import { JobRouteMap } from './job-route-map';
import { ReleaseBooking } from '../shared/release-booking';

export function JobPreview({ job, onAccept, onReleased, acceptanceBlock }: { job: RiderJob; onAccept: () => Promise<void>; onReleased: () => void; acceptanceBlock?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const upcoming = isUpcomingJob(job), timing = jobTiming(job);
  const fare = isDemoPayment(job.paymentMethod) ? job.demoRiderEarnings ?? demoSplit(job.totalFare.toFixed(2),job.demoCommissionBps??1500).riderEarnings : job.totalFare;
  return <div className="rd-flow">
    <div className="rd-flow-body">
      <p className={`rd-timing is-${timing.kind}`}><Clock size={16} aria-hidden="true"/>{timing.label}</p>
      {['older','overdue'].includes(timing.kind) && <p className="rd-help">This request has been waiting. Review its original pickup time before accepting; contact support if it is no longer valid.</p>}
      <dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
      <JobRouteMap key={job.id+job.status} bookingId={job.id} stage={job.status} pickup={{lat:job.pickupLat,lng:job.pickupLng}} dropoff={{lat:job.dropoffLat,lng:job.dropoffLng}} navigation="none"/>
      <div className="rd-preview-fare"><span>{job.paymentMethod === 'CASH' ? 'Cash fare' : 'Rider share'}</span><strong>₱{fare.toFixed(2)}</strong><p>{job.distanceKm} km · {job.type === 'RIDE' ? `${job.passengers ?? 1} passenger(s)` : `${job.cargoWeightKg} kg cargo`}</p></div>
      <p className="rd-help">Requested {formatJobTime(job.createdAt)} · PH time. Customer contact details become available after acceptance.</p>
      {job.status === 'MATCHED' && <ReleaseBooking id={job.id} disabled={!!acceptanceBlock} onReleased={onReleased}/>}
    </div>
    <div className="rd-flow-actions">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {acceptanceBlock && <p role="status" className="rd-help">{acceptanceBlock}</p>}
      <Button disabled={busy || upcoming || !!acceptanceBlock} onClick={async()=>{
        if(pending.current || upcoming || acceptanceBlock)return;pending.current=true;setBusy(true);setError('');
        try { await onAccept(); } catch(failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t accept this request. Refresh jobs to check its availability.'); }
        finally {pending.current=false;setBusy(false);}
      }}>{busy && <Loader2 size={18} className="animate-spin" aria-hidden="true"/>}{upcoming ? 'Available at pickup time' : acceptanceBlock ? 'Acceptance unavailable' : busy ? 'Accepting…' : job.type === 'RIDE' ? 'Accept ride' : 'Accept delivery'}</Button>
      {upcoming && <p className="rd-help">Acceptance opens at the scheduled pickup time.</p>}
    </div>
  </div>;
}
