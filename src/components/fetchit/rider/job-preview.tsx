"use client";
import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatJobTime, isUpcomingJob, jobTiming, type RiderJob } from '@/lib/rider-workspace';
import { riderEarningsForBooking, readFareSnapshot } from '@/lib/fare-policy';
import { travelTimeRange } from '@/lib/eta-policy';
import { JobRouteMap } from './job-route-map';
import { OfferCountdown } from './offer-countdown';
import { DeclineOffer } from './decline-offer';
import type { AcceptancePhase } from '@/lib/rider-acceptance-client';

export function JobPreview({ job, onAccept, onReleased, acceptanceBlock }: { job: RiderJob; onAccept: (onPhase?: (phase: AcceptancePhase) => void) => Promise<void>; onReleased: () => void; acceptanceBlock?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [now, setNow] = useState(Date.now);
  const [declining, setDeclining] = useState(false);
  const [acceptPhase, setAcceptPhase] = useState<AcceptancePhase>('location');
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const expired=job.status==='MATCHED' && !!job.assignmentExpiresAt && Date.parse(job.assignmentExpiresAt)<=now;
  const pending = useRef(false);
  const upcoming = isUpcomingJob(job), timing = jobTiming(job);
  const fare = riderEarningsForBooking(job);
  const savedFare = readFareSnapshot(job.fareBreakdown, job.totalFare);
  return <div className="rd-flow">
    <div className="rd-flow-body">
      {job.status==='MATCHED' && <OfferCountdown expiresAt={job.assignmentExpiresAt}/>}
      {job.dispatch?.pickupEtaSeconds != null && <p className="rd-help">Estimated {travelTimeRange(job.dispatch.pickupEtaSeconds)} min to pickup · planning estimate, no live traffic</p>}
      <p className={`rd-timing is-${timing.kind}`}><Clock size={16} aria-hidden="true"/>{timing.label}</p>
      {['older','overdue'].includes(timing.kind) && <p className="rd-help">This request has been waiting. Review its original pickup time before accepting; contact support if it is no longer valid.</p>}
      <dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
      <JobRouteMap key={job.id} bookingId={job.id} stage={job.status} vehicleClass={job.vehicleClass} pickup={{lat:job.pickupLat,lng:job.pickupLng}} dropoff={{lat:job.dropoffLat,lng:job.dropoffLng}} navigation="none"/>
      <div className="rd-preview-fare"><span>Your transport fare</span><strong>₱{fare.toLocaleString('en-PH')}</strong><p>{job.distanceKm} km · {job.type === 'RIDE' ? `${job.passengers ?? 1} passenger(s)` : `${job.cargoWeightKg} kg cargo`}</p>{savedFare && <p>{job.paymentMethod === 'CASH' ? 'Collect' : 'Customer total'}: ₱{savedFare.totalFare} · Includes ₱{savedFare.bookingFee} Fetch-It booking fee</p>}</div>
      <p className="rd-help">Requested {formatJobTime(job.createdAt)} · PH time. Customer contact details become available after acceptance.</p>
    </div>
    <div className="rd-flow-actions">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {expired && <p role="status" className="rd-help">This offer expired. Refresh jobs for current requests.</p>}
      {acceptanceBlock && <p role="status" className="rd-help">{acceptanceBlock}</p>}
      <Button disabled={busy || declining || expired || upcoming || !!acceptanceBlock} onClick={async()=>{
        if(pending.current || expired || upcoming || acceptanceBlock)return;pending.current=true;setBusy(true);setError('');
        try { await onAccept(setAcceptPhase); } catch(failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t accept this request. Refresh jobs to check its availability.'); }
        finally {pending.current=false;setBusy(false);}
      }}>{busy && <Loader2 size={18} className="animate-spin" aria-hidden="true"/>}{upcoming ? 'Available at pickup time' : acceptanceBlock ? 'Acceptance unavailable' : busy ? acceptPhase === 'accepting' ? 'Accepting booking…' : 'Checking your location…' : job.type === 'RIDE' ? 'Accept ride' : 'Accept delivery'}</Button>
      {job.status === 'MATCHED' && <DeclineOffer id={job.id} disabled={busy || expired || !!acceptanceBlock} onDeclined={onReleased} onBusyChange={value => { pending.current = value; setDeclining(value); }}/>}
      {upcoming && <p className="rd-help">Acceptance opens at the scheduled pickup time.</p>}
    </div>
  </div>;
}
