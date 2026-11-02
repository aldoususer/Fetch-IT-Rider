import { withBookingTelemetry } from "@/lib/booking-telemetry";
import { withRequestLog } from "@/lib/request-guard";
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRider, riderErrorResponse } from '@/lib/rider-access';
import { getRiderReviews, ReviewPageError } from '@/lib/rider-reviews';

async function get(request: Request) {
  try {
    const session = await requireRider(await getSession());
    return NextResponse.json(await getRiderReviews(db, session.uid, new URL(request.url).searchParams.get('cursor')), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ReviewPageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return riderErrorResponse(error);
  }
}

export const GET = withBookingTelemetry("reviews_read", withRequestLog("rider:reviews:GET", get));
