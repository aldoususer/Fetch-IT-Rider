import type { BookingEventAction, BookingStatus, Prisma, UserRole } from "@prisma/client";

export function recordBookingEvent(tx: Prisma.TransactionClient, bookingId: string,
  actor: { uid: string; name: string; role: UserRole },
  change: { action: BookingEventAction; fromStatus?: BookingStatus; toStatus: BookingStatus; riderId?: string | null; reason?: string }) {
  return tx.bookingEvent.create({ data: { bookingId, actorId: actor.uid, actorName: actor.name,
    actorRole: actor.role, ...change } });
}
