import { NextRequest, NextResponse } from "next/server";
import { getRiderSession } from "@/lib/rider-access";
import { db } from "@/lib/db";
import { assignRider, DispatchError } from "@/lib/dispatch";
import { withRequestLog } from "@/lib/request-guard";
import { schedulePushDelivery } from '@/lib/push-delivery';
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRiderSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    const id = (await params).id;
    await assignRider(db, id, { ...session, role: "RIDER" }, body?.reason);
    schedulePushDelivery(id);
    return NextResponse.json({ message: "Booking released and offered to another available rider, or returned to the job board." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DispatchError ? error.message : "Couldn’t release this booking. Please retry." }, { status: error instanceof DispatchError ? error.status : 503 });
  }
}
export const POST = withRequestLog("rider:release:POST", post);
