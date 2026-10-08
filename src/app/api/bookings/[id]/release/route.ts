import { NextRequest, NextResponse } from "next/server";
import { getRiderSession } from "@/lib/rider-access";
import { db } from "@/lib/db";
import { assignRider, DispatchError } from "@/lib/dispatch";
import { withRequestLog } from "@/lib/request-guard";
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRiderSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    await assignRider(db, (await params).id, { ...session, role: "RIDER" }, body?.reason);
    return NextResponse.json({ message: "Booking released and offered to another available rider, or returned to the job board." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DispatchError ? error.message : "Couldn’t release this booking. Please retry." }, { status: error instanceof DispatchError ? error.status : 503 });
  }
}
export const POST = withRequestLog("rider:release:POST", post);
