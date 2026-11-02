import { withBookingTelemetry, timeBooking, bookingFailure, setBookingAction } from "@/lib/booking-telemetry";
import { timedDatabase } from "@/lib/booking-transaction";
import { NextRequest, NextResponse } from "next/server";
import { db as rawDb } from "@/lib/db";
const db = timedDatabase(rawDb);
import { getRiderSession } from "@/lib/rider-access";
import { confirmCashPayment, confirmDropoffArrival, dropoffReachedAt, PaymentError } from "@/lib/payments";
import { bookingView } from "@/lib/db-data";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
type Params = { params: Promise<{ id: string }> };
async function get(_req: NextRequest, { params }: Params) {
  const session = await timeBooking("auth", () => getRiderSession());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const booking = await db.booking.findFirst({ where: { id: (await params).id, riderId: session.uid } });
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return NextResponse.json({ booking: { ...bookingView(booking), dropoffReachedAt: booking.type === "DELIVERY" && booking.paymentMethod === "CASH" ? await dropoffReachedAt(db, booking.id) : null } }, { headers: { "Cache-Control": "private, no-store" } });
}
async function post(req: NextRequest, { params }: Params) {
  try {
    const session = await timeBooking("auth", () => getRiderSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await timeBooking("db.rate_limit", () => limitRequests("rider:payment", session.uid, 30, 60_000));
    const body = await req.json().catch(() => null);
    const { id } = await params;
    const actor = { ...session, role: "RIDER" as const };
    if (body?.action === "ARRIVED_AT_DROPOFF") {
      setBookingAction("dropoff_arrival");
      const result = await confirmDropoffArrival(db, id, actor);
      return NextResponse.json({ booking: { ...bookingView(result.booking), dropoffReachedAt: result.dropoffReachedAt } });
    }
    const booking = await confirmCashPayment(db, id, actor, body?.amount);
    return NextResponse.json({ booking: { ...bookingView(booking), dropoffReachedAt: booking.dropoffReachedAt } });
  } catch (error) {
    if (!(error instanceof PaymentError) && !(error instanceof RateLimitError)) bookingFailure("payment", error);
    if (error instanceof RateLimitError) throw error;
    return NextResponse.json({ error: error instanceof PaymentError ? error.message : "Payment confirmation unavailable. Please retry." }, { status: error instanceof PaymentError ? error.status : 503 });
  }
}
export const GET = withBookingTelemetry("payment_read", withRequestLog("rider:payment:GET", get));
export const POST = withBookingTelemetry("cash_payment", withRequestLog("rider:payment:POST", post));
