'use client';
import { acceptanceLocation } from './rider-location-client';
import type { RiderJob } from './rider-workspace';

export type AcceptancePhase = 'location' | 'accepting';
export async function acceptRiderBooking(bookingId: string, userId: string, onPhase?: (phase: AcceptancePhase) => void): Promise<RiderJob> {
  if (!('Notification' in window) || Notification.permission !== 'granted') throw new Error('Enable notifications through Go online before accepting jobs.');
  onPhase?.('location');
  const location = await acceptanceLocation(userId);
  onPhase?.('accepting');
  let response: Response;
  try {
    response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ status: 'ACCEPTED', location }),
    });
  } catch {
    throw new Error('Acceptance could not be confirmed. Refresh jobs and check Active before trying again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Couldn’t accept this request. Refresh jobs to check its availability.');
  if (data?.booking?.id !== bookingId || data.booking.riderId !== userId || data.booking.status !== 'ACCEPTED') throw new Error('Acceptance could not be confirmed. Refresh jobs and check Active before trying again.');
  return data.booking;
}
