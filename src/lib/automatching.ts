import { planningTravelSeconds } from "./eta-policy";
import { distanceMeters } from './road-routing';
import { randomUUID } from 'node:crypto';
import type { Booking, Prisma, PrismaClient } from '@prisma/client';
import { activeRiderStatuses, freshPresenceWhere, shortlistRiders, rankRiders, usableMatchingLocation, type RankedRider } from './matching-policy';
import { liveApprovalWhere, approvalCoversRoute } from './rider-eligibility';
import { defaultPlatformSettings, validatePlatformSettings } from './platform-policy';
import { requestHasExpired } from './job-expiry';
import { roadRoute, routingEnabled } from './road-routing-service';
import { reserveAvailableRider } from './dispatch';
import { recordBookingEvent } from './booking-events';
import { queueRiderPushTask } from './rider-push-tasks';

const actor = { name: 'Automatic matching', role: 'ADMIN' as const };
const settingsFor = async (db: Pick<PrismaClient, 'platformConfig'>) => {
  const row = await db.platformConfig.findUnique({ where: { id: 'platform' } });
  return row ? validatePlatformSettings(row.settings) : defaultPlatformSettings();
};
export async function queueAutomaticMatching(tx: Prisma.TransactionClient, booking: Booking) {
  const settings = await settingsFor(tx);
  // Future pickups remain visible as scheduled requests. They become matchable
  // when due through the recovery endpoint/feed, not a long-lived browser timer.
  await tx.autoDispatch.create({ data: { bookingId: booking.id, phase: settings.automatchingEnabled ? 'SEARCHING' : 'OPEN', nextAt: booking.scheduledAt && booking.scheduledAt > new Date() ? booking.scheduledAt : new Date() } });
}
async function openRequest(tx: Prisma.TransactionClient, booking: Booking, reason: string) {
  // Keep per-booking exclusions after matching ends. A missed or declined
  // offer must not return to that rider through the open list or push fanout.
  await tx.autoDispatch.update({ where: { bookingId: booking.id }, data: { phase: 'OPEN', lastReason: reason, pickupEtaSeconds: null, ranking: null } });
  await queueRiderPushTask(tx, booking.id, 'NEW_REQUEST', `open:${booking.id}:${booking.updatedAt.getTime()}`);
}
async function chooseRiders(db: PrismaClient, booking: Booking, radiusKm: number) {
  const now = new Date();
  const latitudeRange = radiusKm / 110, longitudeRange = latitudeRange / Math.max(.01, Math.cos(booking.pickupLat * Math.PI / 180));
  const riders = await db.user.findMany({ where: { role: 'RIDER', isBanned: false, id: { notIn: booking.excludedRiderIds },
    riderProfile: { vehicleClass: booking.vehicleClass }, riderPresence: { ...freshPresenceWhere(now), lat: { gte: booking.pickupLat - latitudeRange, lte: booking.pickupLat + latitudeRange }, lng: { gte: booking.pickupLng - longitudeRange, lte: booking.pickupLng + longitudeRange } },
    bookingsAsRider: { none: { status: { in: [...activeRiderStatuses] } } },
    riderApprovals: { some: { vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere(now) } },
    pushSubscriptions: { some: {} },
  }, select: { id: true, authInvalidBefore: true, pushSubscriptions: { select: { updatedAt: true } }, riderPresence: true, riderApprovals: { where: { vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere(now) } } } });
  const eligible = riders.filter(rider => (!rider.authInvalidBefore || rider.pushSubscriptions.some(subscription => subscription.updatedAt > rider.authInvalidBefore!)) && rider.riderApprovals.some(approval => approvalCoversRoute(approval, booking)));
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const candidates = shortlistRiders(eligible, pickup, radiusKm);
  if (routingEnabled()) {
    // Three bounded calls at most, outside database locks. The routing service
    // shares the existing ORS quota and cache; no extra paid API is introduced.
    const deadlineAt = Date.now() + 3000;
    const results = await Promise.all(candidates.map(async candidate => {
      try {
        const route = await roadRoute(candidate, pickup, booking.vehicleClass, { deadlineAt });
        if (booking.vehicleClass === 'TRICYCLE' && booking.type === 'RIDE') {
          const approvals = eligible.find(rider => rider.id === candidate.id)!.riderApprovals;
          if (route.coordinates.some(([lng, lat]) => !approvals.some(approval => approvalCoversRoute(approval, { ...booking, pickupLat: lat, pickupLng: lng, dropoffLat: lat, dropoffLng: lng })))) return null;
        }
        return { ...candidate, pickupEtaSeconds: planningTravelSeconds(route.distanceMeters, route.durationSeconds, booking.vehicleClass) };
      } catch (failure) {
        // No reachable road / out-of-area is not a candidate. Provider outages
        // or shared quota exhaustion fall back honestly to nearby distance.
        return ['ROUTE_SNAP', 'SERVICE_UNAVAILABLE'].includes((failure as { code?: string }).code ?? '') || (failure as { status?: number }).status === 422 ? null : candidate;
      }
    }));
    return rankRiders(results.filter((rider): rider is RankedRider => rider !== null));
  }
  return rankRiders(candidates);
}
// One step is fenced by a persisted worker token. Booking/user row locks are
// shared with manual dispatch and acceptance, preventing duplicate assignment.
export async function advanceAutomaticMatching(db: PrismaClient, bookingId: string, token: string) {
  const settings = await settingsFor(db), now = new Date();
  const prepared = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    let booking = await tx.booking.findUnique({ where: { id: bookingId } });
    const dispatch = await tx.autoDispatch.findUnique({ where: { bookingId } });
    if (!booking || !dispatch || !['SEARCHING', 'OFFERED'].includes(dispatch.phase) || dispatch.workerToken !== token || !dispatch.workerUntil || dispatch.workerUntil <= now) return null;
    if (!['PENDING', 'MATCHED'].includes(booking.status) || requestHasExpired(booking, now)) {
      await tx.autoDispatch.update({ where: { bookingId }, data: { phase: 'DONE' } }); return null;
    }
    if (booking.scheduledAt && booking.scheduledAt > now || booking.paymentMethod !== 'CASH' && booking.paymentStatus !== 'PAID') return null;
    if (booking.status === 'MATCHED') {
      if (dispatch.phase !== 'OFFERED') return null; // A staff member owns this offer.
      if (booking.assignmentExpiresAt && booking.assignmentExpiresAt > now) return { wait: true };
      const previous = booking.riderId;
      booking = await tx.booking.update({ where: { id: bookingId }, data: { status: 'PENDING', riderId: null, assignmentExpiresAt: null,
        excludedRiderIds: [...new Set([...booking.excludedRiderIds, ...(previous ? [previous] : [])])] } });
      await recordBookingEvent(tx, bookingId, actor, { action: 'REASSIGNED', fromStatus: 'MATCHED', toStatus: 'PENDING', reason: 'Offer expired; checking another nearby rider.' });
      await tx.autoDispatch.update({ where: { bookingId }, data: { phase: 'SEARCHING', nextAt: now } });
    }
    if (!settings.automatchingEnabled || dispatch.attempts >= settings.matchingMaxOffers) { await openRequest(tx, booking, 'Released to open requests after automatic offers.'); return null; }
    return { booking };
  });
  if (!prepared || 'wait' in prepared) return;
  const candidates = await chooseRiders(db, prepared.booking, settings.matchingRadiusKm);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } }), dispatch = await tx.autoDispatch.findUnique({ where: { bookingId } }), now = new Date();
    if (!booking || booking.status !== 'PENDING' || booking.riderId || !dispatch || dispatch.workerToken !== token || !dispatch.workerUntil || dispatch.workerUntil <= now || dispatch.phase !== 'SEARCHING' || requestHasExpired(booking, now)) return;
    for (const candidate of candidates) {
      try { await reserveAvailableRider(tx, candidate.id, booking, now, true); } catch (error) { if ((error as { status?: number }).status) continue; throw error; }
      const presence = await tx.riderPresence.findUnique({ where: { userId: candidate.id } });
      // A rider may move while ORS was loading. Re-rank on a later recovery
      // instead of offering a job using an obsolete candidate snapshot.
      if (!usableMatchingLocation(presence, now.getTime()) || distanceMeters({ lat: presence!.lat!, lng: presence!.lng! }, candidate) > 100 || distanceMeters({ lat: presence!.lat!, lng: presence!.lng! }, {lat:booking.pickupLat,lng:booking.pickupLng}) > settings.matchingRadiusKm*1000 || !await tx.customerPushSubscription.findFirst({ where: { customerId: candidate.id }, select: { id: true } })) continue;
      const until = new Date(now.getTime() + settings.matchingOfferSeconds * 1000);
      await tx.booking.update({ where: { id: bookingId }, data: { status: 'MATCHED', riderId: candidate.id, matchedAt: now, assignmentExpiresAt: until } });
      await tx.riderPresence.update({ where: { userId: candidate.id }, data: { lastOfferAt: now } });
      const ranking = candidates.every(rider => rider.pickupEtaSeconds !== null) ? 'ROAD_ETA' : 'DISTANCE';
      await tx.autoDispatch.update({ where: { bookingId }, data: { phase: 'OFFERED', attempts: { increment: 1 }, nextAt: until, pickupEtaSeconds: ranking === 'ROAD_ETA' ? candidate.pickupEtaSeconds : null, ranking, lastReason: ranking === 'ROAD_ETA' ? 'Ranked by pickup road ETA, location freshness and waiting time.' : 'Ranked by nearby distance, location freshness and waiting time; road ETA unavailable.' } });
      await recordBookingEvent(tx, bookingId, actor, { action: dispatch.attempts ? 'REASSIGNED' : 'ASSIGNED', fromStatus: 'PENDING', toStatus: 'MATCHED', riderId: candidate.id, reason: 'Exclusive nearby-rider offer. Rider acceptance is still required.' });
      return;
    }
    await openRequest(tx, booking, 'No nearby rider with recent location and background alerts. Open requests remain available.');
  }, { maxWait: 5000, timeout: 15000 });
}

export async function runAutomaticMatching(db: PrismaClient, bookingId: string, deliver: () => Promise<unknown>, budgetMs = 240_000) {
  const token = randomUUID(), now = new Date();
  const claimed = await db.autoDispatch.updateMany({ where: { bookingId, phase: { in: ['SEARCHING', 'OFFERED'] }, nextAt: { lte: now }, OR: [{ workerUntil: null }, { workerUntil: { lte: now } }] },
    data: { workerToken: token, workerUntil: new Date(now.getTime() + budgetMs + 15_000) } });
  if (!claimed.count) return;
  try {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const current = await db.autoDispatch.findUnique({ where: { bookingId }, include: { booking: { select: { status: true } } } });
      if (!current || current.workerToken !== token || !['SEARCHING', 'OFFERED'].includes(current.phase) || !['PENDING', 'MATCHED'].includes(current.booking.status)) break;
      if (current.nextAt <= new Date()) { await advanceAutomaticMatching(db, bookingId, token); await deliver(); }
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(1000, current.nextAt.getTime() - Date.now()))));
    }
  } finally {
    await db.autoDispatch.updateMany({ where: { bookingId, workerToken: token }, data: { workerToken: null, workerUntil: null } });
  }
}
export async function matchingRecoveryIds(db: PrismaClient, limit = 2) {
  const now = new Date();
  return db.autoDispatch.findMany({ where: { phase: { in: ['SEARCHING', 'OFFERED'] }, nextAt: { lte: now }, OR: [{ workerUntil: null }, { workerUntil: { lte: now } }], booking: { status: { in: ['PENDING', 'MATCHED'] }, OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] } }, orderBy: { nextAt: 'asc' }, take: limit, select: { bookingId: true } });
}
