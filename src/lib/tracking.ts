import { db } from "./db";
import { RiderError } from "./rider-access";

export const TRACKING_SAMPLE_MS = 30_000;
export const TRACKING_RETENTION_DAYS = 30;
export function locationInput(body: unknown) {
  const value = body as { lat?: unknown; lng?: unknown; speedKph?: unknown; heading?: unknown } | null;
  if (!value || typeof value.lat !== "number" || !Number.isFinite(value.lat) || value.lat < -90 || value.lat > 90 ||
      typeof value.lng !== "number" || !Number.isFinite(value.lng) || value.lng < -180 || value.lng > 180 ||
      (value.speedKph != null && (typeof value.speedKph !== "number" || !Number.isFinite(value.speedKph) || value.speedKph < 0 || value.speedKph > 500)) ||
      (value.heading != null && (typeof value.heading !== "number" || !Number.isFinite(value.heading) || value.heading < 0 || value.heading >= 360)))
    throw new RiderError("Provide valid coordinates, speed, and heading.", 400);
  return { lat: value.lat, lng: value.lng, speedKph: value.speedKph as number | undefined, heading: value.heading as number | undefined };
}
export async function publishLocation(ticketId: string, riderId: string, input: ReturnType<typeof locationInput>) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "ticketId" = ${ticketId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { ticketId } });
    if (!booking) throw new RiderError("Ticket not found.", 404);
    if (booking.riderId !== riderId) throw new RiderError("This ticket is not assigned to you.", 403);
    if (!["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(booking.status)) throw new RiderError("Tracking is unavailable for this booking status.", 409);
    const now = new Date();
    const data = { riderId, lat: input.lat, lng: input.lng, speedKph: input.speedKph ?? null, heading: input.heading ?? null, createdAt: now };
    const latest = await tx.bookingLocation.upsert({ where: { bookingId: booking.id }, create: { bookingId: booking.id, ...data }, update: data });
    await tx.riderPresence.upsert({ where: { userId: riderId }, create: { userId: riderId, lat: input.lat, lng: input.lng, locationAt: now }, update: { lat: input.lat, lng: input.lng, locationAt: now } });
    const previous = await tx.trackingUpdate.findFirst({ where: { bookingId: booking.id, source: "NATIVE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!previous || now.getTime() - previous.createdAt.getTime() >= TRACKING_SAMPLE_MS)
      await tx.trackingUpdate.create({ data: { bookingId: booking.id, source: "NATIVE", ...data } });
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
