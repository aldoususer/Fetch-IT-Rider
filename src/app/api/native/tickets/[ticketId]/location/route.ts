import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBearerSession } from "@/lib/session";

type Params = { params: Promise<{ ticketId: string }> };
const TRACKABLE = new Set(["ACCEPTED", "PICKED_UP", "IN_TRANSIT"]);

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = getBearerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role !== "RIDER") {
      return NextResponse.json({ error: "Rider account required." }, { status: 403 });
    }

    const { ticketId } = await params;
    const normalized = decodeURIComponent(ticketId).trim().toUpperCase();
    const body = (await req.json()) as {
      lat?: number;
      lng?: number;
      speedKph?: number;
      heading?: number;
      accuracyMeters?: number;
    };
    if (
      typeof body.lat !== "number" ||
      typeof body.lng !== "number" ||
      !Number.isFinite(body.lat) ||
      !Number.isFinite(body.lng) ||
      body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180
    ) {
      return NextResponse.json({ error: "Valid lat and lng are required." }, { status: 400 });
    }

    const booking = await db.booking.findUnique({ where: { ticketId: normalized } });
    if (!booking) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    if (booking.riderId !== session.uid) {
      return NextResponse.json({ error: "This ticket is not assigned to you." }, { status: 403 });
    }
    if (!TRACKABLE.has(booking.status)) {
      return NextResponse.json(
        { error: `Tracking is unavailable while the booking is ${booking.status}.` },
        { status: 409 },
      );
    }

    const update = await db.$transaction(async (tx) => {
      const created = await tx.trackingUpdate.create({
        data: {
          bookingId: booking.id,
          riderId: session.uid,
          lat: body.lat!,
          lng: body.lng!,
          speedKph: body.speedKph ?? null,
          heading: body.heading ?? null,
        },
      });
      await tx.user.update({
        where: { id: session.uid },
        data: { lat: body.lat!, lng: body.lng!, locationAt: new Date() },
      });
      return created;
    });

    return NextResponse.json({ ok: true, update });
  } catch (error) {
    console.error("[native ticket location]", error);
    return NextResponse.json({ error: "Failed to publish location." }, { status: 500 });
  }
}
