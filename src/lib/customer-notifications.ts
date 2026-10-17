import type { BookingStatus, Prisma } from "@prisma/client";

const rideTitles: Record<BookingStatus, string> = {
  PENDING: "Finding your driver", MATCHED: "A driver has been assigned", ACCEPTED: "Your driver accepted your ride",
  PICKED_UP: "Your pickup code was verified", IN_TRANSIT: "Your ride is heading to drop-off", DELIVERED: "Your ride is complete", CANCELLED: "Your ride was cancelled",
};
const deliveryTitles: Record<BookingStatus, string> = {
  PENDING: "Finding your delivery rider", MATCHED: "A delivery rider has been assigned", ACCEPTED: "Your rider accepted your delivery",
  PICKED_UP: "Your package has been picked up", IN_TRANSIT: "Your delivery is on the way", DELIVERED: "Your package was delivered", CANCELLED: "Your delivery was cancelled",
};

export async function enqueueBookingNotification(tx: Prisma.TransactionClient, event: {
  id: string; bookingId: string; fromStatus: BookingStatus | null; toStatus: BookingStatus; actorRole: string;
}) {
  if (event.fromStatus === event.toStatus) return;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: event.bookingId }, select: { customerId: true, type: true, refCode: true } });
  return tx.customerNotification.create({ data: {
    sourceId: `booking:${event.id}`, customerId: booking.customerId, category: booking.type,
    bookingId: event.bookingId, status: event.toStatus,
    title: (booking.type === "RIDE" ? rideTitles : deliveryTitles)[event.toStatus], body: booking.refCode,
    url: `/?booking=${encodeURIComponent(event.bookingId)}&type=${booking.type}`,
    // Keep the event in the inbox without sending the customer's own action
    // back to their phone (for example, their own cancellation).
    ...(event.actorRole === "CUSTOMER" ? { pushDeliveredAt: new Date() } : {}),
  } });
}

export async function enqueueSupportNotification(tx: Prisma.TransactionClient, message: { id: string; ticketId: string; body: string; createdAt: Date }) {
  const ticket = await tx.supportTicket.findUniqueOrThrow({ where: { id: message.ticketId }, select: { customerId: true } });
  return tx.customerNotification.create({ data: {
    sourceId: `support:${message.id}`, customerId: ticket.customerId, category: "SUPPORT", ticketId: message.ticketId,
    title: "Fetch-It support replied", body: message.body.slice(0, 160), createdAt: message.createdAt,
    url: `/help?ticket=${encodeURIComponent(message.ticketId)}`,
  } });
}
