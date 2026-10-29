import { scheduleReceiptDelivery } from "./receipt-email";
import type { PrismaClient, PaymentStatus } from "@prisma/client";
import { amountInCents, cashConfirmationAvailable, confirmationsMatch, deliveryCashCompletionError, isDemoPayment } from "./payment-policy";

export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Actor = { uid: string; name: string; role: "CUSTOMER" | "RIDER" | "ADMIN" | "SUPERADMIN" };

export async function dropoffReachedAt(db: Pick<PrismaClient, "paymentEvent">, id: string): Promise<Date | null> {
  const event = await db.paymentEvent.findFirst({ where: { bookingId: id, action: "DROPOFF_REACHED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return event?.createdAt ?? null;
}

export async function confirmDropoffArrival(db: PrismaClient, id: string, actor: Actor) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new PaymentError("Booking not found.", 404);
    if (actor.role !== "RIDER" || booking.riderId !== actor.uid) throw new PaymentError("Only the assigned rider can confirm arrival.", 403);
    if (booking.type !== "DELIVERY" || booking.status !== "IN_TRANSIT") throw new PaymentError("Confirm arrival when this delivery reaches drop-off.", 409);
    const previous = await dropoffReachedAt(tx, id);
    if (previous) return { booking, dropoffReachedAt: previous };
    const event = await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: "RIDER", action: "DROPOFF_REACHED", fromStatus: booking.paymentStatus, toStatus: booking.paymentStatus, reason: "Rider confirmed arrival at drop-off. Cash confirmation is now available." } });
    const updated = await tx.booking.update({ where: { id }, data: { updatedAt: new Date() } });
    return { booking: updated, dropoffReachedAt: event.createdAt };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function deliveryPaymentError(db: Pick<PrismaClient, "paymentEvent">, booking: Parameters<typeof deliveryCashCompletionError>[0] & { id: string }) {
  if (booking.type === "DELIVERY" && booking.paymentMethod === "CASH" && !await dropoffReachedAt(db, booking.id)) return "Confirm arrival at drop-off before completing delivery.";
  return deliveryCashCompletionError(booking);
}

// Lock the booking so concurrent confirmations cannot lose each other or race
// a cancellation/reassignment. Store every change as an immutable event.
export async function confirmCashPayment(db: PrismaClient, id: string, actor: Actor, amount: unknown) {
  const cents = amountInCents(amount);
  if (cents === null) throw new PaymentError("Enter the cash amount with up to two decimal places.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new PaymentError("Booking not found.", 404);
    if (actor.role === "CUSTOMER" ? booking.customerId !== actor.uid : actor.role !== "RIDER" || booking.riderId !== actor.uid) throw new PaymentError("You are not a participant in this booking.", 403);
    if (booking.paymentMethod !== "CASH" || !booking.riderId) throw new PaymentError("This booking does not accept cash confirmation.", 409);
    const arrival = booking.type === "DELIVERY" && booking.status === "IN_TRANSIT" ? await dropoffReachedAt(tx, id) : null;
    if (!cashConfirmationAvailable(booking.type, booking.status, arrival)) throw new PaymentError(booking.type === "DELIVERY" ? "Cash confirmation becomes available after the rider confirms arrival at drop-off." : "Cash can be confirmed after a rider accepts this booking.", 409);
    const customer = actor.role === "CUSTOMER";
    const previous = customer ? booking.customerPaidAmount : booking.riderReceivedAmount;
    if (booking.paymentStatus === "REFUNDED" || (booking.paymentStatus === "PAID" && previous !== null)) {
      if (previous !== null && amountInCents(previous.toString()) === cents) return booking;
      throw new PaymentError("This payment record is final. Contact support for a correction.", 409);
    }
    if (booking.paymentStatus === "PAID" && cents !== amountInCents(booking.totalFare.toString())) throw new PaymentError("This payment record is final. Confirm the recorded fare or contact support.", 409);
    if (previous !== null) {
      if (amountInCents(previous.toString()) === cents) return booking;
      throw new PaymentError("Your confirmation is already recorded. Contact support to correct it.", 409);
    }
    const customerAmount = customer ? String(amount) : booking.customerPaidAmount?.toString();
    const riderAmount = customer ? booking.riderReceivedAmount?.toString() : String(amount);
    const matched = confirmationsMatch(customerAmount, riderAmount, booking.totalFare.toString());
    const now = new Date();
    const status = matched || booking.paymentStatus === "PAID" ? "PAID" : "PENDING";
    const reference = matched ? `CASH-${booking.refCode}` : booking.paymentReference;
    const updated = await tx.booking.update({ where: { id }, data: {
      ...(customer ? { customerPaidAmount: cents / 100, customerPaidAt: now } : { riderReceivedAmount: cents / 100, riderReceivedAt: now }),
      paymentStatus: status, ...(matched ? { paidAt: now, receiptEmailQueuedAt: now, receiptEmailNextAttemptAt: now, paymentReference: reference } : {}),
    } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: actor.role,
      action: customer ? "CUSTOMER_CONFIRMED" : "RIDER_CONFIRMED", amount: cents / 100, fromStatus: booking.paymentStatus, toStatus: status, reference } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 }).then(booking => {
    if (booking?.paymentStatus === "PAID") scheduleReceiptDelivery(db);
    return booking;
  });
}

export async function reviewPayment(db: PrismaClient, id: string, actor: Actor, body: { status?: unknown; reason?: unknown; reference?: unknown }) {
  if (actor.role !== "ADMIN" && actor.role !== "SUPERADMIN") throw new PaymentError("Admin account required.", 403);
  if (!["UNPAID", "PENDING", "PAID", "REFUNDED", "FAILED"].includes(String(body.status)) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500 || (body.reference != null && (typeof body.reference !== "string" || body.reference.length > 100))) throw new PaymentError("Choose a status and add a reason of up to 500 characters.");
  const status = body.status as PaymentStatus;
  const reason = body.reason.trim();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new PaymentError("Booking not found.", 404);
    const suppliedReference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (isDemoPayment(booking.paymentMethod) && (status !== "REFUNDED" || booking.paymentStatus !== "PAID" || booking.status !== "DELIVERED" || booking.demoPayoutAt)) throw new PaymentError("Online payments are controlled by checkout. Cancel an active booking to refund it, or record a test refund for a completed paid booking before its payout.", 409);
    if (status === booking.paymentStatus && (!suppliedReference || suppliedReference === booking.paymentReference)) return booking;
    if (booking.paymentStatus === "REFUNDED" || (status === "REFUNDED" && booking.paymentStatus !== "PAID")) throw new PaymentError("Only a paid booking can be refunded; refunded records are final.", 409);
    if (status === "PAID" && !["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(booking.status)) throw new PaymentError("This booking has no accepted service to collect payment for.", 409);
    const reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : booking.paymentReference || `CASH-${booking.refCode}`;
    const updated = await tx.booking.update({ where: { id }, data: { paymentStatus: status,
      paidAt: status === "PAID" ? booking.paidAt ?? new Date() : status === "REFUNDED" ? booking.paidAt : null,
      paymentReference: reference,
      ...(status === "PAID" ? { receiptEmailQueuedAt: booking.receiptEmailQueuedAt ?? new Date(), receiptEmailNextAttemptAt: new Date() } : {}),
      ...(isDemoPayment(booking.paymentMethod) && status === "REFUNDED" ? { demoCommission: null, demoRiderEarnings: null } : {}),
      ...(status === "UNPAID" ? { customerPaidAmount: null, riderReceivedAmount: null, customerPaidAt: null, riderReceivedAt: null } : {}),
    } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: actor.role, action: isDemoPayment(booking.paymentMethod) ? "DEMO_REFUND_RECORDED" : "ADMIN_REVIEWED", fromStatus: booking.paymentStatus, toStatus: status, reason, reference } });
    await tx.adminAudit.create({ data: { actorId: actor.uid, actorName: actor.name, action: "PAYMENT_UPDATED", entityType: "BOOKING", entityId: id, details: { fromStatus: booking.paymentStatus, status, reason, reference } } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 }).then(booking => {
    if (booking?.paymentStatus === "PAID") scheduleReceiptDelivery(db);
    return booking;
  });
}
