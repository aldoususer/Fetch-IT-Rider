import type { PrismaClient, PaymentStatus } from "@prisma/client";
import { amountInCents, confirmationsMatch } from "./payment-policy";

export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Actor = { uid: string; name: string; role: "CUSTOMER" | "RIDER" | "ADMIN" };

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
    if (booking.paymentMethod !== "CASH" || !booking.riderId || !["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(booking.status)) throw new PaymentError("Cash can be confirmed after a rider accepts this booking.", 409);
    const customer = actor.role === "CUSTOMER";
    const previous = customer ? booking.customerPaidAmount : booking.riderReceivedAmount;
    if (booking.paymentStatus === "PAID" || booking.paymentStatus === "REFUNDED") {
      if (previous !== null && amountInCents(previous.toString()) === cents) return booking;
      throw new PaymentError("This payment record is final. Contact support for a correction.", 409);
    }
    if (previous !== null) {
      if (amountInCents(previous.toString()) === cents) return booking;
      throw new PaymentError("Your confirmation is already recorded. Contact support to correct it.", 409);
    }
    const customerAmount = customer ? String(amount) : booking.customerPaidAmount?.toString();
    const riderAmount = customer ? booking.riderReceivedAmount?.toString() : String(amount);
    const matched = confirmationsMatch(customerAmount, riderAmount, booking.totalFare.toString());
    const now = new Date();
    const status = matched ? "PAID" : "PENDING";
    const reference = matched ? `CASH-${booking.refCode}` : booking.paymentReference;
    const updated = await tx.booking.update({ where: { id }, data: {
      ...(customer ? { customerPaidAmount: cents / 100, customerPaidAt: now } : { riderReceivedAmount: cents / 100, riderReceivedAt: now }),
      paymentStatus: status, ...(matched ? { paidAt: now, paymentReference: reference } : {}),
    } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: actor.role,
      action: customer ? "CUSTOMER_CONFIRMED" : "RIDER_CONFIRMED", amount: cents / 100, fromStatus: booking.paymentStatus, toStatus: status, reference } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 });
}

export async function reviewPayment(db: PrismaClient, id: string, actor: Actor, body: { status?: unknown; reason?: unknown; reference?: unknown }) {
  if (actor.role !== "ADMIN") throw new PaymentError("Admin account required.", 403);
  if (!["UNPAID", "PENDING", "PAID", "REFUNDED", "FAILED"].includes(String(body.status)) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500 || (body.reference != null && (typeof body.reference !== "string" || body.reference.length > 100))) throw new PaymentError("Choose a status and add a reason of up to 500 characters.");
  const status = body.status as PaymentStatus;
  const reason = body.reason.trim();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new PaymentError("Booking not found.", 404);
    const suppliedReference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (status === booking.paymentStatus && (!suppliedReference || suppliedReference === booking.paymentReference)) return booking;
    if (booking.paymentStatus === "REFUNDED" || (status === "REFUNDED" && booking.paymentStatus !== "PAID")) throw new PaymentError("Only a paid booking can be refunded; refunded records are final.", 409);
    if (status === "PAID" && !["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(booking.status)) throw new PaymentError("This booking has no accepted service to collect payment for.", 409);
    const reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : booking.paymentReference || `CASH-${booking.refCode}`;
    const updated = await tx.booking.update({ where: { id }, data: { paymentStatus: status,
      paidAt: status === "PAID" ? booking.paidAt ?? new Date() : status === "REFUNDED" ? booking.paidAt : null,
      paymentReference: reference,
      ...(status === "UNPAID" ? { customerPaidAmount: null, riderReceivedAmount: null, customerPaidAt: null, riderReceivedAt: null } : {}),
    } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: "ADMIN", action: "ADMIN_REVIEWED", fromStatus: booking.paymentStatus, toStatus: status, reason, reference } });
    await tx.adminAudit.create({ data: { actorId: actor.uid, actorName: actor.name, action: "PAYMENT_UPDATED", entityType: "BOOKING", entityId: id, details: { fromStatus: booking.paymentStatus, status, reason, reference } } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 });
}
