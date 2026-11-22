"use client";
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, Loader2 } from 'lucide-react';
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
  const [mapOpen, setMapOpen] = useState(false);
  const [acceptPhase, setAcceptPhase] = useState<AcceptancePhase>('location');
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const expired=job.status==='MATCHED' && !!job.assignmentExpiresAt && Date.parse(job.assignmentExpiresAt)<=now;
  const pending = useRef(false);
  const upcoming = isUpcomingJob(job), timing = jobTiming(job);
  const fare = riderEarningsForBooking(job);
  const savedFare = readFareSnapshot(job.fareBreakdown, job.totalFare);
  const passengers = job.passengers ?? 1;
  const cash = job.paymentMethod === 'CASH';
  const separateCash = cash && Math.round(job.totalFare * 100) !== Math.round(fare * 100);
  const unavailable = expired ? 'Offer expired.' : acceptanceBlock || error;
  return <div className="rd-flow">
    <div className="rd-flow-body rd-offer-body">
      <div className="rd-offer-lead">
        <div><p className="rd-help">{cash && !separateCash ? 'You earn · collect in cash' : 'You earn'}</p><strong>₱{fare.toFixed(2)}</strong></div>
        {job.status==='MATCHED' && <OfferCountdown expiresAt={job.assignmentExpiresAt}/>}
      </div>
      {separateCash && <p className="rd-help">Cash to collect <strong>₱{job.totalFare.toFixed(2)}</strong></p>}
      <dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
      <p className="rd-help">{job.distanceKm} km trip · {job.type === 'RIDE' ? `${passengers} ${passengers === 1 ? 'passenger' : 'passengers'}` : `${job.cargoWeightKg} kg cargo`}{job.dispatch?.pickupEtaSeconds != null && ` · About ${travelTimeRange(job.dispatch.pickupEtaSeconds)} min to pickup`}</p>
      {(upcoming || ['overdue','older'].includes(timing.kind)) && <p className={`rd-timing is-${timing.kind}`}><Clock size={16} aria-hidden="true"/>{timing.label}</p>}
      <details className="rd-details" onToggle={event => setMapOpen(event.currentTarget.open)}>
        <summary>View map<ChevronDown size={16} aria-hidden="true"/></summary>
        {mapOpen && <JobRouteMap key={job.id} bookingId={job.id} stage={job.status} vehicleClass={job.vehicleClass} pickup={{lat:job.pickupLat,lng:job.pickupLng}} dropoff={{lat:job.dropoffLat,lng:job.dropoffLng}} navigation="none"/>}
      </details>
      <details className="rd-details">
        <summary>Booking details<ChevronDown size={16} aria-hidden="true"/></summary>
        <p className="rd-help">Requested {formatJobTime(job.createdAt)} · PH time</p>
        {savedFare && <p className="rd-help">Fetch-It booking fee ₱{savedFare.bookingFee.toFixed(2)}</p>}
        {!cash && <p className="rd-help">Customer total ₱{job.totalFare.toFixed(2)} · Online payment</p>}
        {job.dispatch?.pickupEtaSeconds != null && <p className="rd-help">Pickup estimate excludes live traffic.</p>}
      </details>
    </div>
    <div className="rd-flow-actions">
      {unavailable && <p role={unavailable===error?'alert':'status'} className={unavailable===error?'text-sm text-destructive':'rd-help'}>{unavailable}</p>}
      <Button disabled={busy || declining || expired || upcoming || !!acceptanceBlock} onClick={async()=>{
        if(pending.current || expired || upcoming || acceptanceBlock)return;pending.current=true;setBusy(true);setError('');
        try { await onAccept(setAcceptPhase); } catch(failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t accept this request. Refresh jobs to check its availability.'); }
        finally {pending.current=false;setBusy(false);}
      }}>{busy && <Loader2 size={18} className="animate-spin" aria-hidden="true"/>}{upcoming ? 'Available at pickup time' : acceptanceBlock ? 'Acceptance unavailable' : busy ? acceptPhase === 'accepting' ? 'Accepting booking…' : 'Checking your location…' : job.type === 'RIDE' ? 'Accept ride' : 'Accept delivery'}</Button>
      {job.status === 'MATCHED' && <DeclineOffer id={job.id} disabled={busy || expired || !!acceptanceBlock} onDeclined={onReleased} onBusyChange={value => { pending.current = value; setDeclining(value); }}/>}
    </div>
  </div>;
}
