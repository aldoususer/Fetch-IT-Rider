import type { Booking, Prisma } from '@prisma/client';
import { distanceMeters } from './road-routing';
import { cancellationDay, cancellationSummary, cancellationQualifies, cancellationReasons, CANCELLATION_PAUSE_MS, COUNTED_CANCELLATION_PREFIX, EXEMPT_CANCELLATION_PREFIX } from './rider-cancellation-policy';

type Client = Pick<Prisma.TransactionClient, 'bookingEvent' | 'riderPresence'>;
export async function riderCancellationSummary(db: Client, riderId: string, now = new Date(), knownPresence?: { offerPausedUntil: Date | null } | null) {
  const { start, end } = cancellationDay(now);
  const [events, presence] = await Promise.all([
    db.bookingEvent.findMany({ where: { actorId: riderId, actorRole: 'RIDER', createdAt: { gte: start, lt: end }, OR: [
      { toStatus: 'ACCEPTED', NOT: { fromStatus: 'ACCEPTED' } },
      { action: 'REASSIGNED', fromStatus: 'ACCEPTED', OR: [{ reason: { startsWith: COUNTED_CANCELLATION_PREFIX } }, { reason: { startsWith: EXEMPT_CANCELLATION_PREFIX } }] },
    ] }, select: { bookingId: true, toStatus: true, fromStatus: true, reason: true } }),
    knownPresence !== undefined ? Promise.resolve(knownPresence) : db.riderPresence.findUnique({ where: { userId: riderId }, select: { offerPausedUntil: true } }),
  ]);
  // A cancellation of a job accepted before midnight brings that job into this
  // day's denominator too. Repeated events never count the same booking twice.
  const accepted = new Set(events.map(event => event.bookingId));
  const cancelled = new Set(events.filter(event => event.fromStatus === 'ACCEPTED' && event.reason?.startsWith(COUNTED_CANCELLATION_PREFIX)).map(event => event.bookingId));
  return cancellationSummary(accepted.size, cancelled.size, presence?.offerPausedUntil ?? null, now);
}
export async function applyCancellationPause(db: Client, riderId: string, now = new Date()) {
  // Caller holds the User row lock shared with acceptance and going online.
  const summary = await riderCancellationSummary(db, riderId, now);
  if (!cancellationQualifies(summary.cancellations, summary.accepted)) return summary;
  const until = new Date(Math.max(Date.parse(summary.pausedUntil ?? '') || 0, now.getTime() + CANCELLATION_PAUSE_MS));
  await db.riderPresence.upsert({ where: { userId: riderId }, create: { userId: riderId, isOnline: false, offerPausedUntil: until }, update: { offerPausedUntil: until } });
  return cancellationSummary(summary.accepted, summary.cancellations, until, now);
}
export async function cancellationReason(db: Client, booking: Booking, riderId: string, code: unknown, details: string, now = new Date()) {
  const choice = cancellationReasons.find(reason => reason.code === (code ?? 'OTHER'));
  if (!choice) throw new Error('Choose a valid cancellation reason.');
  if (choice.code === 'PASSENGER_NO_SHOW') {
    const [arrival, presence] = await Promise.all([
      db.bookingEvent.findFirst({ where: { bookingId: booking.id, actorId: riderId, riderId, reason: 'PICKUP_PROGRESS:ARRIVED', createdAt: { gte: booking.matchedAt ?? booking.createdAt } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.riderPresence.findUnique({ where: { userId: riderId } }),
    ]);
    const fresh = presence?.locationAt && now.getTime() - presence.locationAt.getTime() <= 30_000 && presence.locationAt <= now;
    if (booking.type !== 'RIDE' || !arrival || now.getTime() - arrival.createdAt.getTime() < 5 * 60_000 || !fresh || presence?.lat == null || presence.lng == null || presence.locationAccuracy == null || presence.locationAccuracy > 100 || presence.locationAccuracy < 0 || distanceMeters({ lat: presence.lat, lng: presence.lng }, { lat: booking.pickupLat, lng: booking.pickupLng }) > 150)
      throw new Error('Passenger no-show needs a recorded arrival, a 5-minute wait and a fresh location near pickup. For an urgent safety issue, choose Safety concern.');
  }
  return { counted: !choice.exempt, reason: `${choice.exempt ? EXEMPT_CANCELLATION_PREFIX : COUNTED_CANCELLATION_PREFIX}${choice.label}: ${details}` };
}
