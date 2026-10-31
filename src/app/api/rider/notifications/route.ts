import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRiderSession, requireRider, RiderError, riderErrorResponse } from '@/lib/rider-access';
import { riderInbox } from '@/lib/rider-inbox';
import { schedulePushDelivery } from '@/lib/push-delivery';

export async function GET() {
  try {
    const session = await requireRider(await getRiderSession());
    const items = await riderInbox(db, session.uid); schedulePushDelivery();
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return riderErrorResponse(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireRider(await getRiderSession());
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)) throw new RiderError('This request is not allowed.', 403);
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.ids) || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== 'string' || id.length > 100)) throw new RiderError('Choose valid notifications.', 400);
    await db.customerNotification.updateMany({ where: { customerId: session.uid, sourceId: { startsWith: 'rider:' }, id: { in: body.ids }, readAt: null }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return riderErrorResponse(error); }
}
