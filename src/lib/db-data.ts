import type { Prisma, RiderProfile, RiderPresence } from "@prisma/client";

// Keep the existing API shape while the database stores separate rider records.
export const riderSelect = {
  id: true, name: true, phone: true,
  // Booking participants never expose a rider's current global location.
  // Customers receive only the latest location recorded for their own booking.
  riderProfile: true,
} as const satisfies Prisma.UserSelect;

type RiderData = { riderProfile?: RiderProfile | null; riderPresence?: RiderPresence | null };
export function riderView<T extends RiderData>(user: T) {
  const { riderProfile, riderPresence, ...account } = user;
  return {
    ...account,
    vehicleClass: riderProfile?.vehicleClass ?? null,
    vehiclePlate: riderProfile?.vehiclePlate ?? null,
    rating: riderProfile?.rating ?? 5,
    totalDeliveries: riderProfile?.totalDeliveries ?? 0,
    isOnline: riderPresence?.isOnline ?? false,
    lat: riderPresence?.lat ?? null, lng: riderPresence?.lng ?? null,
    locationAt: riderPresence?.locationAt ?? null,
  };
}

// Never send authentication identities or password hashes to a client.
export function publicUser(user: RiderData & { id: string; name: string; email: string; role: string; phone: string | null }) {
  return riderView({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone,
    riderProfile: user.riderProfile, riderPresence: user.riderPresence });
}

type Money = number | Prisma.Decimal;
type BookingData = { baseFare?: Money; totalFare?: Money; surgeMultiplier?: Money; rider?: (RiderData & { id?: string; name: string; phone: string | null }) | null;
  liveLocation?: { lat: number; lng: number; createdAt: Date } | null };
export function bookingView<T extends BookingData>(booking: T) {
  const { liveLocation, ...rest } = booking;
  return {
    ...rest,
    ...(booking.baseFare !== undefined ? { baseFare: Number(booking.baseFare) } : {}),
    ...(booking.totalFare !== undefined ? { totalFare: Number(booking.totalFare) } : {}),
    ...(booking.surgeMultiplier !== undefined ? { surgeMultiplier: Number(booking.surgeMultiplier) } : {}),
    ...(booking.rider !== undefined ? { rider: booking.rider ? riderView(booking.rider) : null } : {}),
    ...(liveLocation !== undefined ? { trackingUpdates: liveLocation ? [liveLocation] : [] } : {}),
  };
}
