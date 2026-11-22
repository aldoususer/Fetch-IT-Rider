"use client";
import { useState } from 'react';
import { riderEarningsForBooking } from '@/lib/fare-policy';
import { ArrowUpRight, ChevronDown, MapPin } from 'lucide-react';
import { formatJobTime, historyJobTime, type RiderJob } from '@/lib/rider-workspace';
import { PaymentCard } from '../shared/payment-card';
import { StatusBadge } from '../shared/status-badge';
import { JobRouteMap } from './job-route-map';
import { Button } from '@/components/ui/button';

export function JobHistoryRow({ job, onOpen }: { job: RiderJob; onOpen: () => void }) {
  const time = historyJobTime(job);
  return <button className="rd-history-row" onClick={onOpen} aria-label={`View booking summary ${job.refCode}`}>
    <span className="rd-history-icon"><MapPin size={20} aria-hidden="true"/></span>
    <span className="rd-history-copy"><strong>{job.dropoffLabel}</strong><span className="rd-history-meta"><StatusBadge status={job.status} type={job.type === 'RIDE' ? 'RIDE' : 'DELIVERY'}/><span>{time.label === 'Booked' ? 'Booked ' : ''}{formatJobTime(time.value)} · PH time</span></span></span>
    <span className="rd-history-fare">{job.status === 'CANCELLED' && <small>Quoted</small>}₱{riderEarningsForBooking(job).toFixed(2)}<ArrowUpRight size={16} aria-hidden="true"/></span>
  </button>;
}

export function JobHistorySummary({ job, offline = false, onEarnings }: { job: RiderJob; offline?: boolean; onBack?: () => void; onEarnings?: () => void }) {
  const [routeOpen, setRouteOpen] = useState(false);
  const time = historyJobTime(job);
  return <div className="rd-history-summary rd-flow-body">
    <section className="rd-receipt-heading"><p>{time.label === 'Booked' ? 'Booked ' : ''}{formatJobTime(time.value)} · PH time</p><strong>₱{riderEarningsForBooking(job).toFixed(2)}</strong><span>{job.status === 'CANCELLED' ? 'Quoted fare' : 'You earned'}</span></section>
    <dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
    <div className="rd-receipt-facts"><span>{job.type === 'RIDE' ? `${job.passengers ?? 1} passenger(s)` : `${job.cargoWeightKg} kg cargo`}</span><span>{job.distanceKm} km</span></div>
    <details className="rd-details"><summary>Payment record<ChevronDown size={16} aria-hidden="true"/></summary><PaymentCard embedded bookingId={job.id} role="RIDER" summaryOnly readOnly={offline}/></details>
    <details className="rd-details" onToggle={event => setRouteOpen(event.currentTarget.open)}><summary>Route details<ChevronDown size={16} aria-hidden="true"/></summary>{routeOpen && <JobRouteMap pickup={{lat:job.pickupLat,lng:job.pickupLng}} dropoff={{lat:job.dropoffLat,lng:job.dropoffLng}} navigation="none"/>}</details>
    <p className="rd-help"><a href={`mailto:fetchitsupport@gmail.com?subject=${encodeURIComponent(`Booking review · ${job.refCode}`)}`}>Get help with this booking</a></p>
    <div className="flex flex-wrap gap-3">{job.status === 'DELIVERED' && onEarnings && <Button variant="outline" className="min-h-12 flex-1" onClick={onEarnings}>View earnings</Button>}</div>
  </div>;
}
