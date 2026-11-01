import { approvedServices } from "@/lib/rider-eligibility";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { cookies } from 'next/headers';
import { onlineLocationInput } from '@/lib/matching-policy';
import { schedulePushDelivery } from '@/lib/push-delivery';

export async function POST(req: NextRequest) {
  try {
    const session = await requireRider(await getSession());
    if (req.headers.get('sec-fetch-site') === 'cross-site' || (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin)) throw new RiderError('This request is not allowed.', 403);
    const body = await req.json();
    if (typeof body?.online !== "boolean") throw new RiderError("Choose online or offline.", 400);
    let location;
    if (body.online) {
      try { location = onlineLocationInput(body.location); } catch (error) { throw new RiderError((error as Error).message, 400); }
    }
    const deviceId = (await cookies()).get('fetchit_rider_push_device')?.value;
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${session.uid} FOR UPDATE`;
      if (body.online) {
        const profile = await tx.riderProfile.findUnique({ where: { userId: session.uid } });
        if (!profile || !(await approvedServices(tx, session.uid, profile.vehicleClass)).length) throw new RiderError("Complete your rider application and service approval before going online.", 403);
        if (body.notificationPermission !== 'granted' || !deviceId || !await tx.customerPushSubscription.findFirst({ where: { customerId: session.uid, deviceId }, select: { id: true } })) throw new RiderError('Enable notifications on this device before going online.', 409);
      }
      const data = { isOnline: body.online, ...(body.online ? { ...location, onlineDeviceId: deviceId, onlineAt: new Date() } : { onlineDeviceId: null }) };
      return tx.riderPresence.upsert({ where: { userId: session.uid }, create: { userId: session.uid, ...data }, update: data });
    });
    if (updated.isOnline) schedulePushDelivery();
    return NextResponse.json({ isOnline: updated.isOnline }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return riderErrorResponse(error); }
}
