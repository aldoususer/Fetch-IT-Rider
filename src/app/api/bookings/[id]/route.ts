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
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await limitRequests("rider:booking-status", session.uid, 60, 60_000);
    const { status } = (await req.json()) as { status: BookingStatus };

    if (!BOOKING_STATUS_FLOW.includes(status) && status !== "CANCELLED") {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    const now = new Date();

    if (status === "ACCEPTED" && booking.riderId && booking.riderId !== session.uid) {
      return NextResponse.json({ error: "Another rider already claimed this job." }, { status: 409 });
    }

    // A rider claiming an open, unassigned job: this is the real "accept"
    // action — it atomically assigns the booking to this rider, but only if
    // nobody else claimed it first (protects against two riders accepting
    // the same PENDING job at once).
    if (
      session.role === "RIDER" &&
      status === "ACCEPTED" &&
      booking.riderId == null
    ) {
      if (booking.status !== "PENDING") {
        return NextResponse.json(
          { error: `Booking is already ${booking.status}.` },
          { status: 400 },
        );
      }
      if (booking.scheduledAt && booking.scheduledAt > now) {
        return NextResponse.json({ error: "This scheduled job is not available yet." }, { status: 409 });
      }
      const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
      if (rider?.isBanned) {
        return NextResponse.json(
          { error: "Your account has been restricted and can't accept jobs." },
          { status: 403 },
        );
      }
      if (!rider?.riderPresence?.isOnline) {
        return NextResponse.json({ error: "Go online before accepting jobs." }, { status: 403 });
      }
      if (!rider || rider.riderProfile?.vehicleClass !== booking.vehicleClass) {
        return NextResponse.json(
          { error: "Your vehicle class doesn't match this job." },
          { status: 403 },
        );
      }
      const claim = await db.$transaction(async tx => {
        const claim = await tx.booking.updateMany({
        where: { id, status: "PENDING", riderId: null, OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
        data: { riderId: session.uid, status: "ACCEPTED", matchedAt: now },
      });
        if (claim.count) await recordBookingEvent(tx, id, session, { action: "ASSIGNED", fromStatus: "PENDING", toStatus: "ACCEPTED", riderId: session.uid });
        return claim;
      });
      if (claim.count === 0) {
        return NextResponse.json(
          { error: "Another rider already claimed this job." },
          { status: 409 },
        );
      }
      const claimed = await db.booking.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          rider: { select: riderSelect },
        },
      });
      const claimedSnapshot = claimed ? buildTicketSnapshot(claimed) : null;
      return NextResponse.json({
        booking: claimed
          ? { ...bookingView(claimed), ticket: claimedSnapshot ? encodeTicket(claimedSnapshot) : null }
          : claimed,
      });
    }

    // Only the assigned rider may advance the status (except CANCELLED which
    // is open to the customer via a separate route).
    if (session.role === "RIDER") {
      if (booking.riderId !== session.uid) {
        return NextResponse.json(
          { error: "You are not assigned to this booking." },
          { status: 403 },
        );
      }
      if (status === "ACCEPTED" && booking.scheduledAt && booking.scheduledAt > now) {
        return NextResponse.json({ error: "This scheduled job is not available yet." }, { status: 409 });
      }
    } else if (session.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only the assigned rider may change status." },
        { status: 403 },
      );
    }

    const nextStatus: Record<string, string> = {
      MATCHED: "ACCEPTED",
      ACCEPTED: "PICKED_UP",
      PICKED_UP: "IN_TRANSIT",
      IN_TRANSIT: "DELIVERED",
    };
    if (nextStatus[booking.status] !== status) {
      return NextResponse.json({ error: `Cannot change ${booking.status} to ${status}.` }, { status: 409 });
    }

    const updates: import("@prisma/client").Prisma.BookingUpdateManyMutationInput = { status };

    if (status === "ACCEPTED") updates.matchedAt ??= now;
    if (status === "PICKED_UP") updates.pickedUpAt = now;
    if (status === "DELIVERED") updates.deliveredAt = now;

    // Recompute ETA using distance-based estimate when rider starts moving.
    if (status === "ACCEPTED" || status === "IN_TRANSIT") {
      const v = VEHICLES[booking.vehicleClass as keyof typeof VEHICLES];
      if (v) {
        updates.etaMinutes = etaMinutes(booking.distanceKm, v.speedKph);
      }
    }

    const changed = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      if (status === "DELIVERED" && booking.type === "DELIVERY") {
        const proof = await tx.deliveryProof.findFirst({ where: { bookingId: id, riderId: session.uid, proofType: { in: ["OTP", "SIGNATURE"] }, verifiedAt: { not: null } } });
        if (!proof) return false;
      }
      const result = await tx.booking.updateMany({
        where: { id, status: booking.status, riderId: booking.riderId },
        data: updates,
      });
      if (result.count === 0) return false;
      if (status === "DELIVERED" && booking.riderId) {
        await tx.riderProfile.update({
          where: { userId: booking.riderId },
          data: { totalDeliveries: { increment: 1 } },
        });
      }
      await recordBookingEvent(tx, id, session, { action: "STATUS_CHANGED", fromStatus: booking.status, toStatus: status, riderId: booking.riderId });
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: "Booking status changed. Refresh and try again." }, { status: 409 });
    }
    const updated = await db.booking.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        rider: { select: riderSelect },
      },
    });

    if (!updated) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    const updatedSnapshot = buildTicketSnapshot(updated);
    return NextResponse.json({
      booking: { ...bookingView(updated), ticket: updatedSnapshot ? encodeTicket(updatedSnapshot) : null },
    });
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.error("[bookings/[id] PATCH] error", { code: safeErrorCode(err) });
    return NextResponse.json(
      { error: "Failed to update booking." },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog("rider:bookings/[id]:GET", handleGET);
export const PATCH = withRequestLog("rider:bookings/[id]:PATCH", handlePATCH);
