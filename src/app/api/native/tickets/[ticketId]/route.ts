import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBearerSession } from "@/lib/session";

type Params = { params: Promise<{ ticketId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = getBearerSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "RIDER") {
    return NextResponse.json({ error: "Rider account required." }, { status: 403 });
  }

  const { ticketId } = await params;
  const normalized = decodeURIComponent(ticketId).trim().toUpperCase();
  if (!/^[RD]\d{4,}$/.test(normalized)) {
    return NextResponse.json({ error: "Ticket must look like R0001 or D0001." }, { status: 400 });
  }

  const booking = await db.booking.findUnique({
    where: { ticketId: normalized },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      rider: {
        select: {
          id: true,
          name: true,
          phone: true,
          vehicleClass: true,
          vehiclePlate: true,
          rating: true,
        },
      },
      trackingUpdates: {
        where: { source: "NATIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!booking) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });

  // Sequential ticket IDs are guessable. Never expose customer/job details
  // to an unrelated rider.
  if (booking.riderId !== session.uid) {
    return NextResponse.json(
      { error: "This ticket is not assigned to your rider account." },
      { status: 403 },
    );
  }

  return NextResponse.json({ booking });
}
