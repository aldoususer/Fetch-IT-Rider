export type PickupStage = "ACCEPTED" | "HEADING" | "ARRIVED";
export type PickupProgress = { stage: PickupStage; at: string | null };
export const pickupReasons = ["PICKUP_PROGRESS:HEADING", "PICKUP_PROGRESS:ARRIVED"];
export const pickupEvents = {
  where: { action: "STATUS_CHANGED" as const, reason: { in: pickupReasons } },
  orderBy: { createdAt: "desc" as const }, take: 2,
  select: { riderId: true, reason: true, createdAt: true },
};
export function pickupProgress(booking: {
  type: string; status: string; riderId: string | null; matchedAt?: Date | null; createdAt?: Date;
  events: { riderId: string | null; reason: string | null; createdAt: Date }[];
}): PickupProgress | null {
  if (booking.type !== "RIDE" || booking.status !== "ACCEPTED" || !booking.riderId) return null;
  const since = booking.matchedAt ?? booking.createdAt;
  const currentEvents = booking.events.filter(event => event.riderId === booking.riderId
    && !!since && event.createdAt >= since && pickupReasons.includes(event.reason ?? ""));
  const event = currentEvents.find(event => event.reason === pickupReasons[1]) ?? currentEvents[0];
  return { stage: event?.reason === pickupReasons[1] ? "ARRIVED" : event ? "HEADING" : "ACCEPTED", at: event?.createdAt.toISOString() ?? null };
}
