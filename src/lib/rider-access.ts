import { NextResponse } from "next/server";
import { db } from "./db";
import { getSession, isSessionCurrent, type SessionPayload } from "./session";

export class RiderError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function requireRider(session: SessionPayload | null) {
  if (!session) throw new RiderError("Please sign in again.", 401);
  if (session.role !== "RIDER") throw new RiderError("Rider account required.", 403);
  const user = await db.user.findUnique({ where: { id: session.uid }, select: { role: true, isBanned: true, authInvalidBefore: true } });
  if (!user || user.role !== "RIDER" || user.isBanned) throw new RiderError("Your rider account is unavailable.", 403);
  if (!isSessionCurrent(session, user)) throw new RiderError("Please sign in again.", 401);
  return { ...session, role: "RIDER" as const };
}
export function riderErrorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof RiderError ? error.message : "This service is temporarily unavailable." },
    { status: error instanceof RiderError ? error.status : 503 });
}

export async function getRiderSession() {
  const session = await getSession();
  return session?.role === "RIDER" ? session : null;
}
