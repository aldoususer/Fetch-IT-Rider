import { bookingView, riderSelect } from "@/lib/db-data";
import type { Prisma } from "@prisma/client";
// GET /api/rider/available
// Returns PENDING bookings that match the rider's vehicle class.
// Only meaningful for the RIDER role.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";
import { buildTicketSnapshot, encodeTicket } from "@/lib/ticket";

export async function GET(req: NextRequest) {
  const session = await getRiderSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "RIDER") {
    return NextResponse.json(
      { error: "Only riders can view the available jobs feed." },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const includeMatched = url.searchParams.get("includeMatched") === "true";

  const rider = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  if (!rider || !rider.riderProfile?.vehicleClass) {
    return NextResponse.json(
      { error: "Rider profile is incomplete (missing vehicle class)." },
      { status: 400 },
    );
  }
  if (rider.isBanned) return NextResponse.json({ error: "Account restricted." }, { status: 403 });
  if (!rider.riderPresence?.isOnline) return NextResponse.json({ jobs: [] });

  // PENDING jobs are open to any rider of the matching vehicle class.
  // MATCHED jobs are pre-assigned to *this* rider and waiting for acceptance.
  const due = { OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] };
  const where: Prisma.BookingWhereInput = includeMatched
    ? {
        vehicleClass: rider.riderProfile?.vehicleClass,
        AND: [due],
        OR: [
          { status: "PENDING" },
          { status: "MATCHED", riderId: session.uid },
        ],
      }
    : {
        vehicleClass: rider.riderProfile?.vehicleClass,
        AND: [due],
        status: "PENDING" as const,
      };

  const jobs = await db.booking.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      rider: { select: riderSelect },
    },
  });

  // Attach the copy-pasteable native-app ticket (R0001/D0001 + encoded order
  // snapshot) to each job. Riders only — the customer app never returns this.
  const withTickets = jobs.map((job) => {
    const snapshot = buildTicketSnapshot(job);
    return { ...bookingView(job), ticket: snapshot ? encodeTicket(snapshot) : null };
  });

  return NextResponse.json({ jobs: withTickets });
}
