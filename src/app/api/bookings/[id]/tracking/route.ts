// /api/bookings/[id]/tracking
// GET  — list tracking updates for a booking (newest first).
// POST — rider publishes a new GPS update. We also update the rider's
//        position on their user row so the matching engine reads fresh data.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (
    (session.role === "CUSTOMER" && booking.customerId !== session.uid) ||
    (session.role === "RIDER" && booking.riderId !== session.uid)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates = await db.trackingUpdate.findMany({
    where: { bookingId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ updates });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "RIDER") {
      return NextResponse.json(
        { error: "Only riders can publish tracking updates." },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = (await req.json()) as {
      lat: number;
      lng: number;
      speedKph?: number;
      heading?: number;
      etaMinutes?: number;
    };
    if (body.lat == null || body.lng == null) {
      return NextResponse.json(
        { error: "lat and lng are required." },
        { status: 400 },
      );
    }

    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.riderId !== session.uid) {
      return NextResponse.json(
        { error: "You are not assigned to this booking." },
        { status: 403 },
      );
    }

    const update = await db.trackingUpdate.create({
      data: {
        bookingId: id,
        riderId: session.uid,
        lat: body.lat,
        lng: body.lng,
        speedKph: body.speedKph ?? null,
        heading: body.heading ?? null,
        etaMinutes: body.etaMinutes ?? null,
      },
    });

    // Update rider's live position + booking ETA.
    await db.user.update({
      where: { id: session.uid },
      data: { lat: body.lat, lng: body.lng, locationAt: new Date() },
    });
    if (body.etaMinutes != null) {
      await db.booking.update({
        where: { id },
        data: { etaMinutes: body.etaMinutes },
      });
    }

    return NextResponse.json({ update });
  } catch (err) {
    console.error("[tracking POST] error", err);
    return NextResponse.json(
      { error: "Failed to publish tracking update." },
      { status: 500 },
    );
  }
}
