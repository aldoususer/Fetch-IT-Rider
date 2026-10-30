"use client";
import { useState } from 'react';
import { ArrowUpRight, ChevronDown, MapPin } from 'lucide-react';
import { formatJobTime, type RiderJob } from '@/lib/rider-workspace';
import { PaymentCard } from '../shared/payment-card';
import { StatusBadge } from '../shared/status-badge';
import { JobRouteMap } from './job-route-map';

export function JobHistoryRow({ job, onOpen }: { job: RiderJob; onOpen: () => void }) {
  return <button className="rd-history-row" onClick={onOpen} aria-label={`View booking summary ${job.refCode}`}>
    <span className="rd-history-icon"><MapPin size={20} aria-hidden="true"/></span>
    <span className="rd-history-copy"><span className="rd-history-meta"><span>{job.refCode}</span><StatusBadge status={job.status} type={job.type === 'RIDE' ? 'RIDE' : 'DELIVERY'}/></span><strong>{job.dropoffLabel}</strong><span>{formatJobTime(job.createdAt)} · PH time</span></span>
    <span className="rd-history-fare">₱{job.totalFare.toFixed(2)}<ArrowUpRight size={16} aria-hidden="true"/></span>
  </button>;
}

export function JobHistorySummary({ job, offline = false }: { job: RiderJob; offline?: boolean }) {
  const [routeOpen, setRouteOpen] = useState(false);
  return <div className="rd-history-summary rd-flow-body">
    <section className="rd-receipt-heading"><h3>{job.status === 'CANCELLED' ? 'Booking cancelled' : job.type === 'RIDE' ? 'Ride completed' : 'Delivery completed'}</h3><p>{formatJobTime(job.createdAt)} · Booking created · PH time</p><strong>₱{job.totalFare.toFixed(2)}</strong><span>Recorded fare{job.status === 'CANCELLED' ? ' · not a payment confirmation' : ''}</span></section>
    <dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
    <div className="rd-receipt-facts"><span>{job.type === 'RIDE' ? `${job.passengers ?? 1} passenger(s)` : `${job.cargoWeightKg} kg cargo`}</span><span>{job.distanceKm} km</span></div>
    <PaymentCard bookingId={job.id} role="RIDER" summaryOnly readOnly={offline}/>
    <details className="rd-details" onToggle={event => setRouteOpen(event.currentTarget.open)}><summary>Route details<ChevronDown size={16} aria-hidden="true"/></summary>{routeOpen && <JobRouteMap pickup={{lat:job.pickupLat,lng:job.pickupLng}} dropoff={{lat:job.dropoffLat,lng:job.dropoffLng}} navigation="none"/>}</details>
    <p className="rd-help">Need a correction? <a href={`mailto:fetchitsupport@gmail.com?subject=${encodeURIComponent(`Booking review · ${job.refCode}`)}`}>Contact support about {job.refCode}</a>.</p>
  </div>;
}
