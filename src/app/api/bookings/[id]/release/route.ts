import { NextRequest, NextResponse } from "next/server";
import { getRiderSession } from "@/lib/rider-access";
import { db } from "@/lib/db";
import { assignRider, DispatchError } from "@/lib/dispatch";
import { withRequestLog } from "@/lib/request-guard";
import { schedulePushDelivery } from '@/lib/push-delivery';
import { riderCancellationSummary } from '@/lib/rider-cancellation';
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRiderSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = req.headers.get('origin');
  let sameOrigin = !origin;
  try { if (origin) { const source = new URL(origin); sameOrigin = ['http:', 'https:'].includes(source.protocol) && source.host === req.headers.get('host'); } } catch { sameOrigin = false; }
  if (req.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin) return NextResponse.json({ error: 'This request is not allowed.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  try {
    const id = (await params).id;
    await assignRider(db, id, { ...session, role: "RIDER" }, body?.reason, undefined, body?.offerOnly === true, body?.reasonCode);
    schedulePushDelivery(id);
    const cancellation = body?.offerOnly === true ? null : await riderCancellationSummary(db, session.uid);
    return NextResponse.json({ message: "Your assignment ended. We’re finding another rider for the customer.", cancellation }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DispatchError ? error.message : "Couldn’t release this booking. Please retry." }, { status: error instanceof DispatchError ? error.status : 503 });
  }
}
export const POST = withRequestLog("rider:release:POST", post);
