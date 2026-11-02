import { freshPresenceWhere } from './matching-policy';
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
type PushBooking = Booking & { dispatch: { phase: string } | null };
function bookingStillRelevant(booking: PushBooking, kind: Kind, userId?: string, now = new Date()) {
  if (kind === 'CANCELLED') return booking.status === 'CANCELLED' && !!booking.riderId && (!userId || booking.riderId === userId);
  if (!openRequest(booking)) return false;
  if (kind === 'NEW_REQUEST' && booking.dispatch && booking.dispatch.phase !== 'OPEN' && (!booking.scheduledAt || booking.scheduledAt <= now)) return false;
  if (kind === 'ASSIGNED') return booking.status === 'MATCHED' && !!booking.riderId && (!userId || booking.riderId === userId) && (!booking.assignmentExpiresAt || booking.assignmentExpiresAt > now);
  return booking.status === 'PENDING' && !booking.riderId && (!userId || !booking.excludedRiderIds.includes(userId));
}
function recipientWhere(booking: Booking, kind: Kind, now = new Date()): Prisma.UserWhereInput {
  return { role: 'RIDER', isBanned: false, ...(kind === 'CANCELLED' ? { id: booking.riderId! } : {
    riderProfile: { vehicleClass: booking.vehicleClass }, riderPresence: { ...freshPresenceWhere(now), lat: { gte: -90, lte: 90 }, lng: { gte: -180, lte: 180 } },
    riderApprovals: { some: { vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere(now) } },
    ...(kind === 'NEW_REQUEST' ? { bookingsAsRider: { none: { id: { not: booking.id }, status: { in: [...active] } } } } : { id: booking.riderId! }),
  }) };
}
function approvalSelection(booking: Booking, now = new Date()) {
  return { where: { vehicleClass: booking.vehicleClass, service: booking.type, ...liveApprovalWhere(now) } };
}
export async function riderPushStillRelevant(db: PrismaClient, notification: { sourceId: string; bookingId: string | null; customerId: string; createdAt: Date }) {
  const kind = notification.sourceId.startsWith('rider:new:') ? 'NEW_REQUEST' : notification.sourceId.startsWith('rider:assigned:') ? 'ASSIGNED' : notification.sourceId.startsWith('rider:cancelled:') ? 'CANCELLED' : null;
  if (!kind || !notification.bookingId || notification.createdAt < new Date(Date.now() - 10 * 60_000)) return false;
  const booking = await db.booking.findUnique({ where: { id: notification.bookingId }, include: { dispatch: { select: { phase: true } } } });
  if (!booking || !bookingStillRelevant(booking, kind, notification.customerId)) return false;
  if (kind === 'CANCELLED') return true;
  // Recheck current eligibility at send time, without a series of per-field reads.
  const rider = await db.user.findFirst({ where: { ...recipientWhere(booking, kind), id: notification.customerId },
    select: { riderApprovals: approvalSelection(booking) } });
  return !!rider?.riderApprovals.some(approval => approvalCoversRoute(approval, booking));
}
export async function drainRiderPushTasks(db: PrismaClient, bookingId?: string) {
  const tasks = await db.$queryRaw<Task[]>`UPDATE "RiderNotificationTask" SET "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '60 seconds', "attempts" = "attempts" + 1
    WHERE "id" IN (SELECT "id" FROM "RiderNotificationTask" WHERE "processedAt" IS NULL AND "nextAttemptAt" <= CURRENT_TIMESTAMP
      AND ("leaseUntil" IS NULL OR "leaseUntil" < CURRENT_TIMESTAMP) AND "attempts" < 5
      AND (${bookingId ?? null}::text IS NULL OR "bookingId" = ${bookingId ?? null})
      ORDER BY "createdAt" ASC LIMIT 2 FOR UPDATE SKIP LOCKED) RETURNING *`;
  for (const task of tasks) {
    try {
      const booking = await db.booking.findUnique({ where: { id: task.bookingId }, include: { dispatch: { select: { phase: true } } } });
      let more = false, cursor = task.cursor;
      if (booking && bookingStillRelevant(booking, task.kind, task.riderId ?? undefined) && task.createdAt >= new Date(Date.now() - 10 * 60_000)) {
        const subscriptionWhere = { createdAt: { lte: task.createdAt } };
        const candidates = await db.user.findMany({ where: { ...recipientWhere(booking, task.kind),
          ...(task.riderId ? { id: task.riderId } : task.cursor ? { id: { gt: task.cursor } } : {}),
          pushSubscriptions: { some: subscriptionWhere },
        }, select: { id: true, authInvalidBefore: true, riderApprovals: approvalSelection(booking),
          pushSubscriptions: { where: subscriptionWhere, select: { updatedAt: true } },
        }, orderBy: { id: 'asc' }, take: 25 });
        more = !task.riderId && candidates.length === 25;
        cursor = candidates.at(-1)?.id ?? cursor;
        const prefix = task.kind === 'NEW_REQUEST' ? 'new' : task.kind === 'ASSIGNED' ? 'assigned' : 'cancelled';
        const text = riderPushText(task.kind, booking);
        // Batch the inbox insert; current state is checked again before external push.
        const recipients = candidates.filter(candidate => bookingStillRelevant(booking, task.kind, candidate.id) &&
          (task.kind === 'CANCELLED' || candidate.riderApprovals.some(approval => approvalCoversRoute(approval, booking))) &&
          candidate.pushSubscriptions.some(subscription => !candidate.authInvalidBefore || subscription.updatedAt > candidate.authInvalidBefore));
        if (recipients.length) await db.customerNotification.createMany({ data: recipients.map(candidate => ({
          sourceId: `rider:${prefix}:${task.id}:${candidate.id}`, customerId: candidate.id,
          bookingId: booking.id, category: booking.type, status: booking.status, ...text, url: '/?job=' + encodeURIComponent(booking.id), createdAt: task.createdAt,
        })), skipDuplicates: true });
      }
      await db.$executeRaw`UPDATE "RiderNotificationTask" SET "processedAt" = ${more ? null : new Date()}, "cursor" = ${cursor}, "leaseUntil" = NULL, "attempts" = 0, "nextAttemptAt" = CURRENT_TIMESTAMP WHERE "id" = ${task.id}`;
    } catch {
      await db.$executeRaw`UPDATE "RiderNotificationTask" SET "leaseUntil" = NULL, "nextAttemptAt" = CURRENT_TIMESTAMP + INTERVAL '15 seconds' WHERE "id" = ${task.id}`;
      console.warn(JSON.stringify({ operation: 'rider:push-fanout', code: 'RETRY_PENDING' }));
    }
  }
  return tasks.length;
}
