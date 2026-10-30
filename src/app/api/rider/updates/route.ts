import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRiderSession } from '@/lib/rider-access';
import { liveApprovalWhere, approvalCoversRoute } from '@/lib/rider-eligibility';
import { dispatchPaymentWhere, expireRiderOffers } from '@/lib/dispatch';
import { staleRequestWhere } from '@/lib/job-expiry';

// Lightweight observation on every dashboard tab. No customer contact details,
// coordinates or documents leave this endpoint.
export async function GET() {
  const session = await getRiderSession();
  if (!session || session.role !== 'RIDER') return NextResponse.json({ error: 'Sign in as a rider.' }, { status: 401 });
  const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  if (!rider || rider.isBanned) return NextResponse.json({ error: 'Account restricted.' }, { status: 403 });
  await expireRiderOffers(db);
  const now = new Date();
  if (rider.riderPresence?.isOnline) await db.riderPresence.updateMany({ where: { userId: session.uid, isOnline: true, updatedAt: { lt: new Date(now.getTime() - 60_000) } }, data: { updatedAt: now } });
  const approvals = await db.riderServiceApproval.findMany({ where: { userId: session.uid, vehicleClass: rider.riderProfile?.vehicleClass, ...liveApprovalWhere(now) } });
  const select = { id: true, refCode: true, type: true, status: true, createdAt: true, updatedAt: true, scheduledAt: true } as const;
  const [candidates, assigned] = await Promise.all([
    rider.riderPresence?.isOnline && rider.riderProfile ? db.booking.findMany({
      where: { vehicleClass: rider.riderProfile.vehicleClass, type: { in: [...new Set(approvals.map(a => a.service))] },
        AND: [dispatchPaymentWhere, { NOT: staleRequestWhere(now) }],
        OR: [{ status: 'PENDING', riderId: null, NOT: { excludedRiderIds: { has: session.uid } } }, { status: 'MATCHED', riderId: session.uid }] },
      select: { ...select, vehicleClass: true, pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    }) : [],
    db.booking.findMany({ where: { riderId: session.uid, OR: [{ status: { in: ['MATCHED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'] } }, { updatedAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }] },
      select, orderBy: { updatedAt: 'desc' }, take: 100 }),
  ]);
  const available = candidates.filter(job => approvals.some(a => a.service === job.type && approvalCoversRoute(a, job))).map(job => ({
    id: job.id, refCode: job.refCode, type: job.type, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, scheduledAt: job.scheduledAt,
  }));
  return NextResponse.json({ checkedAt: now.toISOString(), available, assigned }, { headers: { 'Cache-Control': 'private, no-store' } });
}
