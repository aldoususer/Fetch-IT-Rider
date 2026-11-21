import { db } from "./db";
import { RiderError } from "./rider-access";

export const TRACKING_SAMPLE_MS = 30_000;
export const TRACKING_RETENTION_DAYS = 30;
export function locationInput(body: unknown) {
  const value = body as { lat?: unknown; lng?: unknown; speedKph?: unknown; heading?: unknown; capturedAt?: unknown } | null;
  if (!value || typeof value.lat !== "number" || !Number.isFinite(value.lat) || value.lat < -90 || value.lat > 90 ||
      typeof value.lng !== "number" || !Number.isFinite(value.lng) || value.lng < -180 || value.lng > 180 ||
      (value.speedKph != null && (typeof value.speedKph !== "number" || !Number.isFinite(value.speedKph) || value.speedKph < 0 || value.speedKph > 500)) ||
      (value.heading != null && (typeof value.heading !== "number" || !Number.isFinite(value.heading) || value.heading < 0 || value.heading >= 360)))
    throw new RiderError("Provide valid coordinates, speed, and heading.", 400);
  const capturedAt = value.capturedAt;
  if (capturedAt !== undefined && (typeof capturedAt !== "number" || !Number.isFinite(capturedAt) ||
      capturedAt < Date.now() - 30_000 || capturedAt > Date.now() + 5000))
    throw new RiderError("A fresh device location is required. Retry location sharing.", 400);
  return { lat: value.lat, lng: value.lng, speedKph: value.speedKph as number | undefined,
    heading: value.heading as number | undefined, capturedAt: typeof capturedAt === "number" ? new Date(capturedAt) : null };
}
export async function publishLocation(ticketId: string, riderId: string, input: ReturnType<typeof locationInput>, source: "NATIVE" | "BROWSER" = "NATIVE") {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "ticketId" = ${ticketId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { ticketId } });
    if (!booking) throw new RiderError("Ticket not found.", 404);
    if (booking.riderId !== riderId) throw new RiderError("This ticket is not assigned to you.", 403);
    if (!["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(booking.status)) throw new RiderError("Tracking is unavailable for this booking status.", 409);
    const previousFix = await tx.bookingLocation.findUnique({ where: { bookingId: booking.id } });
    if (booking.riderDropoffReportedAt) return previousFix;
    const now = new Date();
    const capturedAt = input.capturedAt ?? null;
    if (capturedAt && now.getTime() - capturedAt.getTime() > 30_000) return previousFix;
    if (previousFix?.capturedAt && (!capturedAt || capturedAt <= previousFix.capturedAt)) return previousFix;
    const data = { riderId, lat: input.lat, lng: input.lng, speedKph: input.speedKph ?? null, heading: input.heading ?? null, createdAt: capturedAt ?? now };
    const fix = { ...data, capturedAt };
    const latest = await tx.bookingLocation.upsert({ where: { bookingId: booking.id }, create: { bookingId: booking.id, ...fix }, update: fix });
    const previous = await tx.trackingUpdate.findFirst({ where: { bookingId: booking.id, source }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!previous || now.getTime() - previous.createdAt.getTime() >= TRACKING_SAMPLE_MS)
      await tx.trackingUpdate.create({ data: { bookingId: booking.id, source, ...data } });
    return latest;
  });
}

export async function cleanupTracking() {
  const cutoff = new Date(Date.now() - TRACKING_RETENTION_DAYS * 86400000);
  // Only remove history for bookings finished at least 30 days ago.
  const booking = { OR: [{ status: "DELIVERED" as const, deliveredAt: { lt: cutoff } }, { status: "CANCELLED" as const, cancelledAt: { lt: cutoff } }] };
  const [history, locations] = await db.$transaction([
    db.trackingUpdate.deleteMany({ where: { booking } }),
    db.bookingLocation.deleteMany({ where: { booking } }),
  ]);
  return { historyDeleted: history.count, locationsDeleted: locations.count };
}
