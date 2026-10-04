import { publicUser } from "@/lib/db-data";
// GET /api/auth/me — returns the current logged-in user (or null).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const user = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  if (!user || user.role !== "RIDER" || user.isBanned) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: publicUser(user),
  });
}
