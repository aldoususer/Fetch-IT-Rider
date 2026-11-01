import type { Prisma } from '@prisma/client';
import { distanceMeters, validRoutePoint, type RoutePoint } from './road-routing';

export const MATCH_LOCATION_MAX_MS = 120_000;
export const ACCEPT_LOCATION_MAX_MS = 30_000;
export const MATCH_ACCURACY_METERS = 100;
export const activeRiderStatuses = ['MATCHED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'] as const;
export const dispatchSelect = { phase: true, attempts: true, pickupEtaSeconds: true, ranking: true } as const;
// Older bookings have no dispatch row and retain their existing open-list flow.
export const openDispatchWhere: Prisma.BookingWhereInput = { OR: [{ dispatch: null }, { dispatch: { phase: 'OPEN' } }] };
export type MatchingFix = { lat: number | null; lng: number | null; locationAt: Date | null; locationAccuracy: number | null };
export function usableMatchingLocation(fix: MatchingFix | null | undefined, now = Date.now(), maximumAge = MATCH_LOCATION_MAX_MS) {
  return !!fix && validRoutePoint(fix) && !!fix.locationAt && now - fix.locationAt.getTime() <= maximumAge &&
    fix.locationAt.getTime() <= now + 5000 && fix.locationAccuracy !== null && Number.isFinite(fix.locationAccuracy) && fix.locationAccuracy >= 0 && fix.locationAccuracy <= MATCH_ACCURACY_METERS;
}
export function freshPresenceWhere(now = new Date()): Prisma.RiderPresenceWhereInput {
  return { isOnline: true, lat: { not: null }, lng: { not: null }, locationAt: { gte: new Date(now.getTime() - MATCH_LOCATION_MAX_MS), lte: new Date(now.getTime() + 5000) }, locationAccuracy: { gte: 0, lte: MATCH_ACCURACY_METERS } };
}
export function onlineLocationInput(value: unknown, now = Date.now()) {
  const fix = value as { lat: number; lng: number; accuracy: number; capturedAt: number } | null;
  if (!fix || !validRoutePoint(fix) || !Number.isFinite(fix.capturedAt) || now - fix.capturedAt > ACCEPT_LOCATION_MAX_MS || fix.capturedAt > now + 5000 ||
      !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > MATCH_ACCURACY_METERS) throw new Error('Share a fresh, accurate location to continue. Turn on device location and try again outdoors.');
  return { lat: fix.lat, lng: fix.lng, locationAt: new Date(fix.capturedAt), locationAccuracy: fix.accuracy };
}
export type RankedRider = { id: string; lat: number; lng: number; locationAt: Date; waitingSince: Date; distanceMeters: number; pickupEtaSeconds: number | null };
export function shortlistRiders(riders: { id: string; riderPresence: (MatchingFix & { onlineAt: Date | null; lastOfferAt: Date | null }) | null }[], pickup: RoutePoint, radiusKm: number, now = Date.now()): RankedRider[] {
  return riders.flatMap(rider => {
    const fix = rider.riderPresence;
    if (!usableMatchingLocation(fix, now)) return [];
    const point = { lat: fix!.lat!, lng: fix!.lng! }, distance = distanceMeters(point, pickup);
    return distance <= radiusKm * 1000 ? [{ id: rider.id, ...point, locationAt: fix!.locationAt!, waitingSince: fix!.lastOfferAt ?? fix!.onlineAt ?? new Date(0), distanceMeters: distance, pickupEtaSeconds: null }] : [];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters || a.waitingSince.getTime() - b.waitingSince.getTime() || a.id.localeCompare(b.id)).slice(0, 3);
}
export function rankRiders(riders: RankedRider[], now = Date.now()) {
  // Compare road ETA only when every remaining candidate has a route. Never
  // compare metres with seconds or pretend an estimate uses live traffic.
  const byRoad = riders.length > 0 && riders.every(rider => rider.pickupEtaSeconds !== null);
  const metric = (rider: RankedRider) => byRoad ? rider.pickupEtaSeconds! : rider.distanceMeters;
  const tier = (rider: RankedRider) => Number(now - rider.locationAt.getTime() > 60_000);
  const minimum = [0, 1].map(value => Math.min(...riders.filter(rider => tier(rider) === value).map(metric)));
  const bucket = (rider: RankedRider) => Math.floor((metric(rider) - minimum[tier(rider)]) / (byRoad ? 30 : 100));
  return [...riders].sort((a, b) => {
    const freshness = Number(now - a.locationAt.getTime() > 60_000) - Number(now - b.locationAt.getTime() > 60_000);
    return freshness || bucket(a) - bucket(b) || a.waitingSince.getTime() - b.waitingSince.getTime() || a.id.localeCompare(b.id);
  });
}

export function availableRequestWhere(riderId: string, now = new Date()): Prisma.BookingWhereInput {
  return { OR: [
    { status: 'PENDING', riderId: null, NOT: { excludedRiderIds: { has: riderId } }, AND: [{ OR: [openDispatchWhere, { scheduledAt: { gt: now } }] }] },
    { status: 'MATCHED', riderId, OR: [{ assignmentExpiresAt: null }, { assignmentExpiresAt: { gt: now } }] },
  ] };
}
