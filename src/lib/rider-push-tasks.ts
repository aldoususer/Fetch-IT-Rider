import { createHash } from 'node:crypto';
import type { Booking, Prisma, PrismaClient } from '@prisma/client';
import { approvalCoversRoute, liveApprovalWhere } from './rider-eligibility';
import { requestHasExpired } from './job-expiry';

type Kind = 'NEW_REQUEST' | 'ASSIGNED' | 'CANCELLED';
type Task = { id: string; bookingId: string; riderId: string | null; kind: Kind; createdAt: Date; attempts: number; cursor: string | null };
const active = ['MATCHED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'] as const;
export async function queueRiderPushTask(tx: Prisma.TransactionClient, bookingId: string, kind: Kind, source: string, riderId: string | null = null) {
  const id = createHash('sha256').update(JSON.stringify([kind, source])).digest('hex');
  // One small durable insert, in the booking transaction; recipient fanout and
  // external push delivery happen after the response, outside the ticket lock.
  await tx.$executeRaw`INSERT INTO "RiderNotificationTask" ("id", "bookingId", "riderId", "kind")
    VALUES (${id}, ${bookingId}, ${riderId}, ${kind}) ON CONFLICT ("id") DO NOTHING`;
}
function openRequest(booking: Booking, now = new Date()) {
  return ['PENDING', 'MATCHED'].includes(booking.status) && !requestHasExpired(booking, now) &&
    (booking.paymentMethod === 'CASH' || booking.paymentStatus === 'PAID');
}
export function riderPushText(kind: Kind, booking: Pick<Booking, 'type' | 'scheduledAt' | 'refCode'>, now = new Date()) {
  const scheduled = !!booking.scheduledAt && booking.scheduledAt > now;
  const title = kind === 'CANCELLED' ? 'Booking cancelled' : kind === 'ASSIGNED' ? 'A job was offered to you' : scheduled ? 'New scheduled request' : booking.type === 'RIDE' ? 'New ride request' : 'New delivery request';
  const body = kind === 'CANCELLED' ? 'This booking has ended. Do not continue to pickup.' : kind === 'ASSIGNED' ? 'Review the offer before it expires.' : scheduled ? 'Review the pickup time. Acceptance opens when pickup is due.' : 'Open Fetch-It to check the route, fare and current availability.';
  return { title, body: booking.refCode + ' · ' + body };
}
async function recipientStillEligible(db: PrismaClient, booking: Booking, userId: string, kind: Kind) {
  if (kind === 'CANCELLED') return booking.status === 'CANCELLED' && booking.riderId === userId;
  if (!openRequest(booking)) return false;
  if (kind === 'ASSIGNED' && (booking.status !== 'MATCHED' || booking.riderId !== userId || (booking.assignmentExpiresAt && booking.assignmentExpiresAt <= new Date()))) return false;
  if (kind === 'NEW_REQUEST' && (booking.status !== 'PENDING' || booking.riderId || booking.excludedRiderIds.includes(userId))) return false;
  const rider = await db.user.findUnique({ where: { id: userId }, include: { riderProfile: true, riderPresence: true } });
  if (!rider || rider.role !== 'RIDER' || rider.isBanned || !rider.riderPresence?.isOnline || rider.riderProfile?.vehicleClass !== booking.vehicleClass) return false;
  const approval = await db.riderServiceApproval.findFirst({ where: { userId, vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere() } });
  if (!approval || !approvalCoversRoute(approval, booking)) return false;
  return kind === 'ASSIGNED' || await db.booking.count({ where: { riderId: userId, id: { not: booking.id }, status: { in: [...active] } } }) === 0;
}
export async function riderPushStillRelevant(db: PrismaClient, notification: { sourceId: string; bookingId: string | null; customerId: string; createdAt: Date }) {
  const kind = notification.sourceId.startsWith('rider:new:') ? 'NEW_REQUEST' : notification.sourceId.startsWith('rider:assigned:') ? 'ASSIGNED' : notification.sourceId.startsWith('rider:cancelled:') ? 'CANCELLED' : null;
  if (!kind || !notification.bookingId || notification.createdAt < new Date(Date.now() - 10 * 60_000)) return false;
  const booking = await db.booking.findUnique({ where: { id: notification.bookingId } });
  return !!booking && recipientStillEligible(db, booking, notification.customerId, kind);
}
export async function drainRiderPushTasks(db: PrismaClient) {
  const tasks = await db.$queryRaw<Task[]>`UPDATE "RiderNotificationTask" SET "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '60 seconds', "attempts" = "attempts" + 1
    WHERE "id" IN (SELECT "id" FROM "RiderNotificationTask" WHERE "processedAt" IS NULL AND "nextAttemptAt" <= CURRENT_TIMESTAMP
      AND ("leaseUntil" IS NULL OR "leaseUntil" < CURRENT_TIMESTAMP) AND "attempts" < 5
      ORDER BY "createdAt" ASC LIMIT 2 FOR UPDATE SKIP LOCKED) RETURNING *`;
  for (const task of tasks) {
    try {
      const booking = await db.booking.findUnique({ where: { id: task.bookingId } });
      let more = false, cursor = task.cursor;
      if (booking && task.createdAt >= new Date(Date.now() - 10 * 60_000)) {
        const subscriptionWhere = { createdAt: { lte: task.createdAt } };
        const candidates = await db.user.findMany({ where: { role: 'RIDER', isBanned: false,
          ...(task.riderId ? { id: task.riderId } : { ...(task.cursor ? { id: { gt: task.cursor } } : {}), riderProfile: { vehicleClass: booking.vehicleClass }, riderPresence: { isOnline: true },
            bookingsAsRider: { none: { status: { in: [...active] } } }, riderApprovals: { some: { vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere() } } }),
          pushSubscriptions: { some: subscriptionWhere },
        }, select: { id: true, authInvalidBefore: true }, orderBy: { id: 'asc' }, take: 25 });
        more = !task.riderId && candidates.length === 25;
        cursor = candidates.at(-1)?.id ?? cursor;
        const prefix = task.kind === 'NEW_REQUEST' ? 'new' : task.kind === 'ASSIGNED' ? 'assigned' : 'cancelled';
        const text = riderPushText(task.kind, booking);
        for (let offset = 0; offset < candidates.length; offset += 5) await Promise.all(candidates.slice(offset, offset + 5).map(async candidate => {
          if (!await recipientStillEligible(db, booking, candidate.id, task.kind)) return;
          // A password reset invalidates older device registrations.
          if (!await db.customerPushSubscription.findFirst({ where: { customerId: candidate.id, ...subscriptionWhere,
            ...(candidate.authInvalidBefore ? { updatedAt: { gt: candidate.authInvalidBefore } } : {}) }, select: { id: true } })) return;
          await db.customerNotification.createMany({ data: [{ sourceId: `rider:${prefix}:${task.id}:${candidate.id}`, customerId: candidate.id,
            bookingId: booking.id, category: booking.type, status: booking.status, ...text, url: '/?job=' + encodeURIComponent(booking.id), createdAt: task.createdAt }], skipDuplicates: true });
        }));
      }
      await db.$executeRaw`UPDATE "RiderNotificationTask" SET "processedAt" = ${more ? null : new Date()}, "cursor" = ${cursor}, "leaseUntil" = NULL, "attempts" = 0, "nextAttemptAt" = CURRENT_TIMESTAMP WHERE "id" = ${task.id}`;
    } catch {
      await db.$executeRaw`UPDATE "RiderNotificationTask" SET "leaseUntil" = NULL, "nextAttemptAt" = CURRENT_TIMESTAMP + INTERVAL '15 seconds' WHERE "id" = ${task.id}`;
      console.warn(JSON.stringify({ operation: 'rider:push-fanout', code: 'RETRY_PENDING' }));
    }
  }
  return tasks.length;
}
