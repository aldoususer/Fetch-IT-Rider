import type { BookingEventAction, BookingStatus, Prisma, UserRole } from "@prisma/client";
import { enqueueBookingNotification } from "./customer-notifications";

export async function recordBookingEvent(tx: Prisma.TransactionClient, bookingId: string,
  actor: { uid?: string; name: string; role: UserRole },
  change: { action: BookingEventAction; fromStatus?: BookingStatus; toStatus: BookingStatus; riderId?: string | null; reason?: string }) {
  const event = await tx.bookingEvent.create({ data: { bookingId, actorId: actor.uid, actorName: actor.name,
    actorRole: actor.role, ...change } });
  await enqueueBookingNotification(tx, event);
  return event;
}
