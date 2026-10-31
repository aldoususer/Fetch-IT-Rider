import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRider, RiderError, riderErrorResponse } from '@/lib/rider-access';
import { riderCanTakeBooking, approvalCoversRoute, liveApprovalWhere } from '@/lib/rider-eligibility';
import { requestHasExpired } from '@/lib/job-expiry';
import { limitRequests, withRequestLog } from '@/lib/request-guard';
import { roadRoute } from '@/lib/road-routing-service';
import { RoutingError } from '@/lib/road-routing';

export const runtime = 'nodejs';
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRider(await getSession());
    const origin = req.headers.get('origin');
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === req.headers.get('host'); } catch {}
    if (req.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin) throw new RiderError('This request is not allowed.', 403);
    const { id } = await params;
    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) throw new RiderError('Booking unavailable.', 404);
    const preview = booking.status === 'PENDING' || booking.status === 'MATCHED';
    if (booking.riderId !== session.uid) {
      if (booking.riderId || !preview || requestHasExpired(booking, new Date()) || booking.excludedRiderIds.includes(session.uid)) throw new RiderError('This route is unavailable to you.', 403);
      const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
      if (!rider?.riderPresence?.isOnline || rider.riderProfile?.vehicleClass !== booking.vehicleClass || !await riderCanTakeBooking(db, session.uid, booking)) throw new RiderError('This route is unavailable to you.', 403);
    }
    if (!preview && !['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(booking.status)) throw new RiderError('Navigation is available only for current jobs.', 409);
    await limitRequests('rider:road-route', session.uid, 15, 60000);
    let start = { lat: booking.pickupLat, lng: booking.pickupLng };
    let finish = { lat: booking.dropoffLat, lng: booking.dropoffLng };
    if (!preview) {
      const presence = await db.riderPresence.findUnique({ where: { userId: session.uid } });
      const age = presence?.locationAt ? Date.now() - presence.locationAt.getTime() : Infinity;
      if (presence?.lat == null || presence.lng == null || age > 30000 || age < -5000) throw new RoutingError('ROUTE_LOCATION', 'Turn on location sharing and wait for a fresh location to start directions.', 422);
      start = { lat: presence.lat, lng: presence.lng };
      if (booking.status === 'ACCEPTED') finish = { lat: booking.pickupLat, lng: booking.pickupLng };
    }
    const route = await roadRoute(start, finish, booking.vehicleClass);
    if (booking.vehicleClass === 'TRICYCLE' && booking.type === 'RIDE') {
      const approval = await db.riderServiceApproval.findFirst({ where: { userId: session.uid, vehicleClass: 'TRICYCLE', service: 'RIDE', ...liveApprovalWhere() } });
      if (!approval || route.coordinates.some(([lng, lat]) => !approvalCoversRoute(approval, { vehicleClass: 'TRICYCLE', type: 'RIDE', pickupLat: lat, pickupLng: lng, dropoffLat: lat, dropoffLng: lng })))
        throw new RoutingError('ROUTE_ZONE', 'This route leaves your approved tricycle operating area. Contact support for an approved route.', 422);
    }
    // Check assignment/status again after the external call. A cancellation,
    // reassignment or stage change must not return obsolete navigation.
    const current = await db.booking.findUnique({ where: { id }, select: { status: true, riderId: true } });
    if (!current || current.status !== booking.status || current.riderId !== booking.riderId) throw new RiderError('Booking changed. Refresh the job before loading directions.', 409);
    return NextResponse.json({ route, destination: preview ? 'preview' : booking.status === 'ACCEPTED' ? 'pickup' : 'dropoff', approximate: true });
  } catch (error) {
    if (error instanceof RoutingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error && typeof error === 'object' && 'retryAfter' in error) throw error;
    return riderErrorResponse(error);
  }
}
export const POST = withRequestLog('rider:road-route:POST', handlePOST);
