import { requireRider, riderErrorResponse } from "@/lib/rider-access";
import { publicUser } from "@/lib/db-data";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBearerSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireRider(getBearerSession(req)); }
  catch (error) { return riderErrorResponse(error); }
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "RIDER") {
    return NextResponse.json({ error: "Rider account required." }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: { riderProfile: true, riderPresence: true },
  });
  if (!user || user.role !== "RIDER" || user.isBanned) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ user: publicUser(user) });
}
