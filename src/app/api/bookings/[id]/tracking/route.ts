// /api/bookings/[id]/tracking
// GET  — list tracking updates for a booking (newest first).
// Phone GPS updates are accepted only by /api/native/tickets/[ticketId]/location.

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
