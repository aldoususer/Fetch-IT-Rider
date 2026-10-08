import { expireRiderOffers, reserveAvailableRider, DispatchError } from "@/lib/dispatch";
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
    await expireRiderOffers(db);
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking) throw new DispatchError("Booking not found.", 404);
      const now = new Date();
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
      if (status === "DELIVERED" && booking.type === "DELIVERY") {
        const proof = await tx.deliveryProof.findFirst({ where: { bookingId: id, riderId: session.uid, proofType: { in: ["OTP", "SIGNATURE"] }, verifiedAt: { not: null } } });
        if (!proof) throw new DispatchError("Record a verified delivery code or signature before completing delivery.");
      }
      const result = await tx.booking.update({ where: { id }, data: {
        status, ...(status === "ACCEPTED" ? { riderId: session.uid, matchedAt: now, assignmentExpiresAt: null } : {}),
        ...(status === "PICKED_UP" ? { pickedUpAt: now } : {}), ...(status === "DELIVERED" ? { deliveredAt: now } : {}),
        ...(["ACCEPTED", "IN_TRANSIT"].includes(status) ? { etaMinutes: etaMinutes(booking.distanceKm, VEHICLES[booking.vehicleClass].speedKph) } : {}),
      }, include: { customer: { select: { id: true, name: true, phone: true } }, rider: { select: riderSelect } } });
      if (status === "DELIVERED") await tx.riderProfile.update({ where: { userId: session.uid }, data: { totalDeliveries: { increment: 1 } } });
      await recordBookingEvent(tx, id, { ...session, role: "RIDER" }, { action: status === "ACCEPTED" && !booking.riderId ? "ASSIGNED" : "STATUS_CHANGED", fromStatus: booking.status, toStatus: status, riderId: session.uid });
      return result;
    }, { maxWait: 10000, timeout: 20000 });
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
