import { settleDemoEarnings } from "@/lib/demo-payments";
import { isDemoPayment } from "@/lib/payment-policy";
import { reserveAvailableRider, DispatchError } from "@/lib/dispatch";
import { withRequestLog, RateLimitError, limitRequests, safeErrorCode } from "@/lib/request-guard";
import { bookingView, riderSelect } from "@/lib/db-data";
import { recordBookingEvent } from "@/lib/booking-events";
// /api/bookings/[id]
// GET    — fetch a single booking (with customer / rider / proofs / latest tracking).
// PATCH  — rider updates the booking status (ACCEPTED | PICKED_UP | IN_TRANSIT | DELIVERED).
//          Each transition also timestamps the appropriate field and updates ETA.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";
import {
  BOOKING_STATUS_FLOW,
  type BookingStatus,
  VEHICLES,
} from "@/lib/constants";
import { etaMinutes } from "@/lib/fare";
import { buildTicketSnapshot, encodeTicket } from "@/lib/ticket";
import { riderJobView } from "@/lib/job-privacy";
import { isPortableChallenge, matchesChallenge } from "@/lib/delivery-challenge";
import { deliveryPaymentError } from "@/lib/payments";

type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const session = await getRiderSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      rider: { select: riderSelect },
      trackingUpdates: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      deliveryProofs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (
    session.role === "CUSTOMER" &&
    booking.customerId !== session.uid
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.role === "RIDER" && booking.riderId !== session.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const snapshot = buildTicketSnapshot(booking);
  return NextResponse.json({
    booking: riderJobView({ ...bookingView(booking), ticket: snapshot ? encodeTicket(snapshot) : null }),
  });
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getRiderSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    await limitRequests("rider:booking-status", session.uid, 60, 60_000);
    const body = await req.json().catch(() => null);
    const status = body?.status as BookingStatus;
    if (!["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status)) return NextResponse.json({ error: "Invalid status. Use release booking to decline before pickup." }, { status: 400 });
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking) throw new DispatchError("Booking not found.", 404);
      if (isDemoPayment(booking.paymentMethod) && booking.paymentStatus !== "PAID") throw new DispatchError("This demo booking needs a successful demo payment before it can progress.");
      const now = new Date();
      if (status === "ACCEPTED" && booking.status === "ACCEPTED" && booking.riderId === session.uid) {
        return tx.booking.findUniqueOrThrow({ where: { id }, include: { customer: { select: { id: true, name: true, phone: true } }, rider: { select: riderSelect } } });
      }
      if (status === "ACCEPTED") {
        if (!["PENDING", "MATCHED"].includes(booking.status) || (booking.riderId && booking.riderId !== session.uid) || booking.excludedRiderIds.includes(session.uid)) throw new DispatchError("This booking is no longer available to you.");
        if (booking.scheduledAt && booking.scheduledAt > now) throw new DispatchError("This scheduled booking is not due yet.");
        if (booking.assignmentExpiresAt && booking.assignmentExpiresAt <= now) throw new DispatchError("This booking offer has expired. Refresh the job board.");
        await reserveAvailableRider(tx, session.uid, booking, now);
      } else {
        if (booking.riderId !== session.uid) throw new DispatchError("You are no longer assigned to this booking.", 403);
        const next: Record<string, string> = { ACCEPTED: "PICKED_UP", PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "DELIVERED" };
        if (next[booking.status] !== status) throw new DispatchError(`Cannot change ${booking.status} to ${status}.`);
      }
      if (status === "PICKED_UP" && booking.type === "RIDE") {
        if (typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp.trim()))
          return { error: "Enter the passenger's 6-digit pickup code before boarding.", status: 400 };
        const challenge = await tx.deliveryChallenge.findUnique({ where: { bookingId: id } });
        if (!challenge || challenge.expiresAt <= now)
          return { error: "Ask the passenger to reveal a new pickup code.", status: 400 };
        if (challenge.verifiedAt) return { error: "This pickup code has already been used.", status: 409 };
        if (challenge.attempts >= challenge.maxAttempts)
          return { error: "Too many incorrect attempts. Wait for expiry and ask for a new pickup code.", status: 429 };
        if (!isPortableChallenge(challenge.codeHash) && !matchesChallenge(id, body.otp.trim(), challenge.codeHash))
          return { error: "Ask the passenger to tap Refresh pickup code, then enter the code shown. This older code needs to be refreshed.", status: 409 };
        const ok = matchesChallenge(id, body.otp.trim(), challenge.codeHash);
        await tx.deliveryChallenge.update({ where: { bookingId: id }, data: {
          attempts: { increment: 1 }, ...(ok ? { verifiedAt: now } : {}),
        } });
        // Commit failed attempts; a thrown error would roll them back.
        if (!ok) return { error: "Pickup code did not match. Confirm it with the passenger.", status: 400 };
      }
      if (status === "DELIVERED" && booking.type === "DELIVERY") {
        const paymentError = await deliveryPaymentError(tx, booking);
        if (paymentError) throw new DispatchError(paymentError);
        const proof = await tx.deliveryProof.findFirst({ where: { bookingId: id, riderId: session.uid, proofType: "SIGNATURE", verifiedAt: { not: null } } });
        if (!proof) throw new DispatchError("Record a recipient signature before completing delivery.");
      }
      const result = await tx.booking.update({ where: { id }, data: {
        status, ...(status === "ACCEPTED" ? { riderId: session.uid, matchedAt: now, assignmentExpiresAt: null } : {}),
        ...(status === "PICKED_UP" ? { pickedUpAt: now } : {}), ...(status === "DELIVERED" ? { deliveredAt: now } : {}),
        ...(["ACCEPTED", "IN_TRANSIT"].includes(status) ? { etaMinutes: etaMinutes(booking.distanceKm, VEHICLES[booking.vehicleClass].speedKph) } : {}),
      }, include: { customer: { select: { id: true, name: true, phone: true } }, rider: { select: riderSelect } } });
      if (status === "DELIVERED") await tx.riderProfile.update({ where: { userId: session.uid }, data: { totalDeliveries: { increment: 1 } } });
      if (status === "DELIVERED") await settleDemoEarnings(tx, result);
      await recordBookingEvent(tx, id, { ...session, role: "RIDER" }, { action: status === "ACCEPTED" && !booking.riderId ? "ASSIGNED" : "STATUS_CHANGED", fromStatus: booking.status, toStatus: status, riderId: session.uid });
      if (status === "DELIVERED") return tx.booking.findUniqueOrThrow({ where: { id }, include: { customer: { select: { id: true, name: true, phone: true } }, rider: { select: riderSelect } } });
      return result;
    }, { maxWait: 10000, timeout: 20000 });
    if ("error" in updated) return NextResponse.json({ error: updated.error }, { status: updated.status });
    const snapshot = buildTicketSnapshot(updated);
    return NextResponse.json({ booking: { ...bookingView(updated), ticket: snapshot ? encodeTicket(snapshot) : null } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof DispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[rider status]", { code: safeErrorCode(error) });
    return NextResponse.json({ error: "Couldn’t update booking. Please retry." }, { status: 503 });
  }
}

export const GET = withRequestLog("rider:bookings/[id]:GET", handleGET);
export const PATCH = withRequestLog("rider:bookings/[id]:PATCH", handlePATCH);
