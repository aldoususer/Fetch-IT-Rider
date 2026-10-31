import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRiderSession, requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { webPushIdentity } from "@/lib/push-delivery";
import { parsePushSubscription } from "@/lib/push-input";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";

const DEVICE_COOKIE = "fetchit_rider_push_device";
async function get() {
  try {
    const session = await requireRider(await getRiderSession());
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (deviceId) await db.customerPushSubscription.deleteMany({ where: { deviceId, customerId: { not: session.uid } } });
    const identity = await webPushIdentity();
    const enabled = !!deviceId && !!await db.customerPushSubscription.findFirst({ where: { deviceId, customerId: session.uid }, select: { id: true } });
    return NextResponse.json({ publicKey: identity.publicKey, enabled }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return riderErrorResponse(error); }
}

async function post(request: NextRequest) {
  try {
    const session = await requireRider(await getRiderSession());
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)) throw new RiderError('This request is not allowed.', 403);
    await limitRequests("rider:push-subscription", session.uid, 20, 60_000);
    const parsed = parsePushSubscription(await request.json().catch(() => null));
    if (!parsed) throw new RiderError("This device supplied an invalid push subscription.", 400);
    const jar = await cookies();
    const savedDevice = jar.get(DEVICE_COOKIE)?.value;
    const deviceId = savedDevice && /^[a-f0-9-]{36}$/.test(savedDevice) ? savedDevice : randomUUID();
    await db.$transaction(async tx => {
      // Device changes and account switching must never leave a previous
      // customer's notifications associated with this browser subscription.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.endpoint}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.uid} FOR UPDATE`;
      const count = await tx.customerPushSubscription.count({ where: { customerId: session.uid, deviceId: { not: deviceId } } });
      if (count >= 10) throw new RiderError("Push notifications are already enabled on ten devices. Turn off an older device first.", 409);
      await tx.customerPushSubscription.deleteMany({ where: { OR: [{ deviceId }, { endpoint: parsed.endpoint }] } });
      await tx.customerPushSubscription.create({ data: { ...parsed, customerId: session.uid, deviceId } });
    });
    jar.set(DEVICE_COOKIE, deviceId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
    return NextResponse.json({ enabled: true });
  } catch (error) { if (error instanceof RateLimitError) throw error; return riderErrorResponse(error); }
}

async function remove() {
  try {
    const session = await requireRider(await getRiderSession());
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (deviceId) await db.customerPushSubscription.deleteMany({ where: { deviceId, customerId: session.uid } });
    return NextResponse.json({ enabled: false });
  } catch (error) { return riderErrorResponse(error); }
}
export const GET = withRequestLog("rider:push:GET", get);
export const POST = withRequestLog("rider:push:POST", post);
export const DELETE = withRequestLog("rider:push:DELETE", remove);
