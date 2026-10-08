import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession } from "@/lib/rider-access";
import { confirmCashPayment, PaymentError } from "@/lib/payments";
import { bookingView } from "@/lib/db-data";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
type Params = { params: Promise<{ id: string }> };
async function get(_req: NextRequest, { params }: Params) {
  const session = await getRiderSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const booking = await db.booking.findFirst({ where: { id: (await params).id, riderId: session.uid } });
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return NextResponse.json({ booking: bookingView(booking) });
}
async function post(req: NextRequest, { params }: Params) {
  try {
    const session = await getRiderSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await limitRequests("rider:payment", session.uid, 30, 60_000);
    const body = await req.json().catch(() => null);
    const booking = await confirmCashPayment(db, (await params).id, { ...session, role: "RIDER" }, body?.amount);
    return NextResponse.json({ booking: bookingView(booking) });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return NextResponse.json({ error: error instanceof PaymentError ? error.message : "Payment confirmation unavailable. Please retry." }, { status: error instanceof PaymentError ? error.status : 503 });
  }
}
export const GET = withRequestLog("rider:payment:GET", get);
export const POST = withRequestLog("rider:payment:POST", post);
