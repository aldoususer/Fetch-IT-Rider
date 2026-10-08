import type { Booking, Prisma, PrismaClient } from "@prisma/client";
export const OFFER_TTL_MS = 2 * 60_000;
const activeStatuses = ["MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] as const;
type Actor = { uid: string; name: string; role: "ADMIN" | "RIDER" };
export class DispatchError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

async function eligible(tx: Prisma.TransactionClient, riderId: string, booking: Booking, now: Date) {
  // Serialize every reservation/acceptance for a rider, preventing two jobs
  // from reserving the same available rider concurrently.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${riderId} FOR UPDATE`;
  const rider = await tx.user.findUnique({ where: { id: riderId }, include: { riderProfile: true, riderPresence: true } });
  if (!rider || rider.role !== "RIDER" || rider.isBanned || rider.riderProfile?.vehicleClass !== booking.vehicleClass || !rider.riderPresence?.isOnline || rider.riderPresence.updatedAt.getTime() < now.getTime() - 5 * 60_000) return false;
  return await tx.booking.count({ where: { id: { not: booking.id }, riderId, status: { in: [...activeStatuses] } } }) === 0;
}

export async function reserveAvailableRider(tx: Prisma.TransactionClient, riderId: string, booking: Booking, now: Date) {
  if (!await eligible(tx, riderId, booking, now)) throw new DispatchError("Choose an online rider with a matching vehicle and no active booking.");
}

async function offerNext(tx: Prisma.TransactionClient, booking: Booking, actor: { uid?: string; name: string; role: "ADMIN" | "RIDER" }, reason: string, requested?: string) {
  const now = new Date();
  if (!["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) || booking.pickedUpAt) throw new DispatchError("Reassignment is available only before pickup.");
  if (booking.customerPaidAt || booking.riderReceivedAt || booking.paymentStatus === "PAID" || booking.paymentStatus === "REFUNDED") throw new DispatchError("Payment has been recorded. Ask an admin to resolve payment before reassigning.");
  if (booking.scheduledAt && booking.scheduledAt > now) throw new DispatchError("Assign this booking when its scheduled pickup becomes due.");
  if (requested && requested === booking.riderId) throw new DispatchError("This rider is already assigned.");
  const excluded = [...new Set([...booking.excludedRiderIds, ...(booking.riderId ? [booking.riderId] : [])])];
  let riderId: string | null = null;
  if (requested) {
    await reserveAvailableRider(tx, requested, booking, now);
    riderId = requested;
  } else if (excluded.length < 5) {
    const candidates = await tx.user.findMany({ where: { role: "RIDER", isBanned: false, id: { notIn: excluded },
      riderProfile: { vehicleClass: booking.vehicleClass }, riderPresence: { isOnline: true, updatedAt: { gte: new Date(now.getTime() - 5 * 60_000) } },
      bookingsAsRider: { none: { id: { not: booking.id }, status: { in: [...activeStatuses] } } },
    }, select: { id: true }, orderBy: { id: "asc" }, take: 20 });
    for (const candidate of candidates) {
      if (await eligible(tx, candidate.id, booking, now)) { riderId = candidate.id; break; }
    }
  }
  const toStatus = riderId ? "MATCHED" : "PENDING";
  const updated = await tx.booking.update({ where: { id: booking.id }, data: { riderId, status: toStatus,
    matchedAt: riderId ? now : null, assignmentExpiresAt: riderId ? new Date(now.getTime() + OFFER_TTL_MS) : null,
    excludedRiderIds: requested ? excluded.filter(id => id !== requested) : excluded,
  } });
  // Remove location and unused proof challenges belonging to the previous rider.
  await tx.bookingLocation.deleteMany({ where: { bookingId: booking.id } });
  await tx.deliveryChallenge.deleteMany({ where: { bookingId: booking.id } });
  await tx.bookingEvent.create({ data: { bookingId: booking.id, actorId: actor.uid ?? null, actorName: actor.name, actorRole: actor.role,
    action: booking.riderId ? "REASSIGNED" : "ASSIGNED", fromStatus: booking.status, toStatus, riderId, reason } });
  if (actor.uid && actor.role === "ADMIN") await tx.adminAudit.create({ data: { actorId: actor.uid, actorName: actor.name, action: "RIDER_ASSIGNED", entityType: "BOOKING", entityId: booking.id, details: { previousRiderId: booking.riderId, riderId, reason } } });
  return updated;
}

export async function assignRider(db: PrismaClient, id: string, actor: Actor, reason: unknown, riderId?: unknown) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new DispatchError("Add a reason of up to 500 characters.", 400);
  if (actor.role === "ADMIN" && (typeof riderId !== "string" || !riderId || riderId.length > 100)) throw new DispatchError("Choose a rider.", 400);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new DispatchError("Booking not found.", 404);
    if (actor.role === "RIDER" && booking.riderId !== actor.uid) throw new DispatchError("This booking is no longer assigned to you.", 403);
    return offerNext(tx, booking, actor, reason.trim(), actor.role === "ADMIN" ? riderId as string : undefined);
  }, { maxWait: 10000, timeout: 20000 });
}

// Run on the jobs feed as well as the protected scheduler endpoint. Expiry is
// checked again under the lock, so simultaneous polls cannot reassign twice.
export async function expireRiderOffers(db: PrismaClient) {
  const now = new Date();
  const rows = await db.booking.findMany({ where: { status: "MATCHED", assignmentExpiresAt: { lte: now } }, select: { id: true }, orderBy: { assignmentExpiresAt: "asc" }, take: 5 });
  let expired = 0;
  for (const row of rows) {
    const changed = await db.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Booking" WHERE "id" = ${row.id} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return false;
      const booking = await tx.booking.findUnique({ where: { id: row.id } });
      if (!booking || booking.status !== "MATCHED" || !booking.assignmentExpiresAt || booking.assignmentExpiresAt > now) return false;
      await offerNext(tx, booking, { name: "Automatic dispatch", role: "ADMIN" }, "Rider did not accept within 2 minutes");
      return true;
    }, { maxWait: 10000, timeout: 20000 });
    if (changed) expired++;
  }
  return expired;
}
