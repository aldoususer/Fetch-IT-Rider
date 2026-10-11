import type { Booking, Prisma, PrismaClient } from "@prisma/client";
import { demoSplit, isDemoPayment } from "./payment-policy";
import { PaymentError } from "./payments";

type Actor = { uid: string; name: string; role: "CUSTOMER" | "RIDER" | "ADMIN" };

// Snapshot the configured rate when the booking is created, so a later rate
// change cannot silently change an existing rider's demo earnings.
export function demoCommissionBps() {
  const rate = process.env.DEMO_COMMISSION_PERCENT ?? "15";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) throw new PaymentError("Demo commission configuration is invalid.", 503);
  return Math.round(Number(rate) * 100);
}

function payable(booking: Booking) {
  if (!isDemoPayment(booking.paymentMethod)) throw new PaymentError("Choose a demo payment method for this booking.", 409);
  if (!["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) || booking.pickedUpAt) throw new PaymentError("Demo checkout is available only before pickup.", 409);
  if (["PAID", "REFUNDED"].includes(booking.paymentStatus)) throw new PaymentError("This demo payment is already final.", 409);
}

export async function startDemoCheckout(db: PrismaClient, id: string, actor: Actor) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking || actor.role !== "CUSTOMER" || booking.customerId !== actor.uid) throw new PaymentError("Booking not found.", 404);
    payable(booking);
    const pending = await tx.demoCheckout.findFirst({ where: { bookingId: id, status: "PENDING" } });
    if (pending) return pending;
    const checkout = await tx.demoCheckout.create({ data: { bookingId: id } });
    await tx.booking.update({ where: { id }, data: { paymentStatus: "PENDING" } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: "CUSTOMER", action: "DEMO_CHECKOUT_STARTED", fromStatus: booking.paymentStatus, toStatus: "PENDING", reference: `DEMO-${checkout.id}` } });
    return checkout;
  }, { maxWait: 10000, timeout: 20000 });
}

// Completion runs in the same transaction as the rider's status/proof update.
export async function settleDemoEarnings(tx: Prisma.TransactionClient, booking: Booking) {
  if (!isDemoPayment(booking.paymentMethod) || booking.status !== "DELIVERED" || booking.paymentStatus !== "PAID" || !booking.riderId || booking.demoRiderEarnings !== null) return;
  if (booking.demoCommissionBps === null) throw new PaymentError("Demo commission is missing.", 409);
  const split = demoSplit(booking.totalFare.toString(), booking.demoCommissionBps);
  await tx.booking.update({ where: { id: booking.id }, data: { demoCommission: split.commission, demoRiderEarnings: split.riderEarnings } });
  await tx.paymentEvent.create({ data: { bookingId: booking.id, actorId: booking.riderId, actorName: "Demo accounting", actorRole: "RIDER", action: "DEMO_EARNINGS_RECORDED", amount: split.riderEarnings, fromStatus: "PAID", toStatus: "PAID", reason: `${booking.demoCommissionBps / 100}% demo commission; no real money moved.` } });
}

export async function resolveDemoCheckout(db: PrismaClient, checkoutId: string, actor: Actor, outcome: unknown) {
  if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(outcome))) throw new PaymentError("Choose a demo checkout result.");
  return db.$transaction(async tx => {
    const attempt = await tx.demoCheckout.findUnique({ where: { id: checkoutId } });
    if (!attempt) throw new PaymentError("Demo checkout not found.", 404);
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${attempt.bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: attempt.bookingId } });
    if (actor.role !== "CUSTOMER" || booking.customerId !== actor.uid) throw new PaymentError("Demo checkout not found.", 404);
    const checkout = await tx.demoCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
    if (checkout.status !== "PENDING") {
      if (checkout.status === outcome) return booking;
      throw new PaymentError("This demo checkout result has already been recorded.", 409);
    }
    payable(booking);
    const now = new Date();
    const status = outcome === "SUCCEEDED" ? "PAID" : outcome === "FAILED" ? "FAILED" : "UNPAID";
    const reference = `DEMO-${checkout.id}`;
    await tx.demoCheckout.update({ where: { id: checkoutId }, data: { status: outcome as "SUCCEEDED" | "FAILED" | "CANCELLED", resolvedAt: now } });
    const updated = await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: status, paymentReference: reference,
      ...(outcome === "SUCCEEDED" ? { paidAt: now, customerPaidAt: now, customerPaidAmount: booking.totalFare } : {}) } });
    await tx.paymentEvent.create({ data: { bookingId: booking.id, actorId: actor.uid, actorName: actor.name, actorRole: "CUSTOMER", action: `DEMO_CHECKOUT_${outcome}`, amount: outcome === "SUCCEEDED" ? booking.totalFare : null, fromStatus: booking.paymentStatus, toStatus: status, reference, reason: "Simulated checkout; no real money moved." } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 });
}

// Caller holds the booking lock. Booking cancellation and refund are atomic,
// including invalidation of any open checkout in another browser tab.
export async function cancelDemoPayment(tx: Prisma.TransactionClient, booking: Booking, actor: Actor) {
  if (!isDemoPayment(booking.paymentMethod)) return;
  await tx.demoCheckout.updateMany({ where: { bookingId: booking.id, status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  const status = booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus === "REFUNDED" ? "REFUNDED" : "UNPAID";
  await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: status, demoCommission: null, demoRiderEarnings: null } });
  if (status !== booking.paymentStatus) await tx.paymentEvent.create({ data: { bookingId: booking.id, actorId: actor.uid, actorName: actor.name, actorRole: actor.role, action: status === "REFUNDED" ? "DEMO_REFUND_RECORDED" : "DEMO_CHECKOUT_CANCELLED", amount: status === "REFUNDED" ? booking.totalFare : null, fromStatus: booking.paymentStatus, toStatus: status, reason: "Booking cancelled; simulated funds only." } });
}

export async function recordDemoPayout(db: PrismaClient, id: string, actor: Actor, body: { reference?: unknown; reason?: unknown }) {
  if (actor.role !== "ADMIN") throw new PaymentError("Admin account required.", 403);
  if (typeof body.reference !== "string" || !body.reference.trim() || body.reference.length > 100 || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) throw new PaymentError("Add a demo payout reference and a reason.");
  const reference = `DEMO-${body.reference.trim()}`;
  const reason = body.reason.trim();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new PaymentError("Booking not found.", 404);
    if (!isDemoPayment(booking.paymentMethod) || booking.status !== "DELIVERED" || booking.paymentStatus !== "PAID" || !booking.riderId || booking.demoRiderEarnings === null) throw new PaymentError("Only completed, paid demo bookings with recorded rider earnings can have a demo payout.", 409);
    if (booking.demoPayoutAt) {
      if (booking.demoPayoutReference === reference) return booking;
      throw new PaymentError("A demo payout is already recorded.", 409);
    }
    const updated = await tx.booking.update({ where: { id }, data: { demoPayoutAt: new Date(), demoPayoutReference: reference } });
    await tx.paymentEvent.create({ data: { bookingId: id, actorId: actor.uid, actorName: actor.name, actorRole: "ADMIN", action: "DEMO_PAYOUT_RECORDED", amount: booking.demoRiderEarnings, fromStatus: "PAID", toStatus: "PAID", reason, reference } });
    await tx.adminAudit.create({ data: { actorId: actor.uid, actorName: actor.name, action: "DEMO_PAYOUT_RECORDED", entityType: "BOOKING", entityId: id, details: { riderId: booking.riderId, amount: booking.demoRiderEarnings.toString(), reference, reason, simulated: true } } });
    return updated;
  }, { maxWait: 10000, timeout: 20000 });
}
