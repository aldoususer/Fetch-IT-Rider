import { dispatchSelect } from '@/lib/matching-policy';
import { expireRiderOffers } from "@/lib/dispatch";
import { bookingView, riderSelect } from "@/lib/db-data";
import type { Prisma } from "@prisma/client";
// /api/bookings
// GET — list bookings for the current rider (active / history).
// NOTE: this is the RIDER app. Creating bookings is a customer action and
// lives in the separate Fetch-It Customer app.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";
import { buildTicketSnapshot, encodeTicket } from "@/lib/ticket";
import { riderJobView } from "@/lib/job-privacy";
import { riderHistoryDateWhere } from '@/lib/rider-history-date';

export async function GET(req: NextRequest) {
  const session = await getRiderSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "active"; // active | history | all
  const date = filter === 'history' ? url.searchParams.get('date') || '' : '';
  const basis = filter === 'history' ? url.searchParams.get('dateBasis') || 'created' : 'created';
  if (basis !== 'created' && basis !== 'finished') return NextResponse.json({ error: 'Choose booking date or completed/cancelled date.' }, { status: 400 });
  const dateWhere = date ? riderHistoryDateWhere(date, basis) : null;
  if (date && !dateWhere) return NextResponse.json({ error: 'Choose a valid history date.' }, { status: 400 });
  await expireRiderOffers(db);

  const where =
    session.role === "CUSTOMER"
      ? { customerId: session.uid }
      : session.role === "RIDER"
        ? { riderId: session.uid }
        : {};

  const statusFilter: Prisma.BookingWhereInput =
    filter === "active"
      ? { status: { in: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } }
      : filter === "history"
        ? { status: { in: ["DELIVERED", "CANCELLED"] } }
        : {};

  const bookings = await db.booking.findMany({
    where: { ...where, ...statusFilter, ...dateWhere },
    orderBy: filter === "active" ? [{ riderDropoffReportedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] : { createdAt: "desc" },
    include: { dispatch: { select: dispatchSelect },
      customer: { select: { id: true, name: true, phone: true } },
      rider: { select: riderSelect },
      deliveryProofs: true,
    },
    take: 100,
  });

  // Rider app — attach each booking's native-app ticket (see src/lib/ticket.ts).
  const withTickets = bookings.map((b) => {
    const snapshot = buildTicketSnapshot(b);
    return riderJobView({ ...bookingView(b), ticket: snapshot ? encodeTicket(snapshot) : null });
  });

  return NextResponse.json({ checkedAt: new Date().toISOString(), bookings: withTickets });
}
