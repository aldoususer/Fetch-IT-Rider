'use client';
import { acceptanceLocation } from './rider-location-client';
import type { RiderJob } from './rider-workspace';
import { startBookingTiming } from './booking-client-timing';
import { savedMutation } from './booking-mutation-client';

export type AcceptancePhase = 'location' | 'accepting';
export async function acceptRiderBooking(bookingId: string, userId: string, onPhase?: (phase: AcceptancePhase) => void): Promise<RiderJob> {
  if (!('Notification' in window) || Notification.permission !== 'granted') throw new Error('Enable notifications through Go online before accepting jobs.');
  const timing = startBookingTiming('job_accept');
  let outcome: 'confirmed' | 'recovered' | 'failed' | 'uncertain' = 'failed';
  try {
  onPhase?.('location');
  const location = await acceptanceLocation(userId);
  onPhase?.('accepting');
  let uncertain = true;
  try {
    const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...timing.headers }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ status: 'ACCEPTED', location }),
    });
    timing.response(response);
    uncertain = response.ok || response.status >= 500;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Couldn’t accept this request. Refresh jobs to check its availability.');
    if (data?.booking?.id !== bookingId || data.booking.riderId !== userId || data.booking.status !== 'ACCEPTED') throw new Error('Acceptance could not be confirmed. Refresh jobs and check Active before trying again.');
    outcome = 'confirmed';
    return data.booking;
  } catch (error) {
    if (!uncertain) throw error;
    outcome = 'uncertain';
    const saved = await savedMutation<{ booking: RiderJob }>(`/api/bookings/${encodeURIComponent(bookingId)}`, state => state.booking?.id === bookingId && state.booking.riderId === userId && ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(state.booking.status));
    if (saved) { outcome = 'recovered'; return saved.booking; }
    throw new Error('Acceptance could not be confirmed. Refresh jobs and check Active before trying again.');
  }
  } finally { timing.finish(outcome); }
}
