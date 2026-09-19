// Fetch-It domain constants — vehicle classes, fares, statuses.
// Kept in a single place so the UI and API agree on values.
//
// PRICING NOTE (PHP, Metro Manila / provincial urban baseline):
// Rates are benchmarked against Philippine on-demand delivery and trucking
// pricing — Lalamove / Grab Express style for the 2-wheel and sedan classes,
// and standard FTL/LTL trucking rates for van, flatbed and reefer.
// Every amount below is in Philippine pesos.

export type Role = "CUSTOMER" | "RIDER" | "ADMIN";

/** The two products a customer can book after logging in. */
export type BookingType = "DELIVERY" | "RIDE";

export type VehicleClass =
  | "MOTORCYCLE"
  | "TRICYCLE"
  | "SEDAN"
  | "CLOSED_VAN"
  | "FLATBED"
  | "REFRIGERATED";

/** Vehicle classes offered for the RIDE product (passenger transport). */
export const RIDE_VEHICLE_CLASSES: VehicleClass[] = [
  "MOTORCYCLE",
  "TRICYCLE",
  "SEDAN",
];

export type BookingStatus =
  | "PENDING"
  | "MATCHED"
  | "ACCEPTED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

export type ProofType = "SIGNATURE" | "OTP" | "PHOTO";

/**
 * Straight-line (haversine) distance always understates the real trip.
 * Philippine urban road networks — one-way streets, no-left-turn schemes,
 * river and rail crossings — typically add 25–40%. We bill on the adjusted
 * figure so the quote matches what the rider actually drives.
 */
export const ROAD_DISTANCE_FACTOR = 1.3;

/**
 * Past this distance the trip is mostly expressway / provincial highway
 * rather than city crawling, so the per-km rate steps down.
 */
export const LONG_HAUL_THRESHOLD_KM = 30;

export interface VehicleMeta {
  id: VehicleClass;
  label: string;
  description: string;
  /** Flagdown. Covers the first `includedKm` of the trip. PHP. */
  baseFare: number;
  /** Distance already paid for by the base fare. km. */
  includedKm: number;
  /** PHP per km from `includedKm` up to LONG_HAUL_THRESHOLD_KM. */
  perKm: number;
  /** PHP per km beyond LONG_HAUL_THRESHOLD_KM. */
  longHaulPerKm: number;
  /** Floor for the whole booking, applied after surge. PHP. */
  minimumFare: number;
  capacityKg: number;
  /** Weight carried at no extra charge. kg. */
  freeWeightKg: number;
  /** PHP per kg above `freeWeightKg`. */
  perKgOverFree: number;
  icon: string; // emoji or short tag used by UI
  /** Assumed average moving speed for ETA, kph — PH urban traffic. */
  speedKph: number;
  /** Loading, securing and paperwork time added to every ETA. minutes. */
  handlingMinutes: number;
}

export const VEHICLES: Record<VehicleClass, VehicleMeta> = {
  MOTORCYCLE: {
    id: "MOTORCYCLE",
    label: "Motorcycle",
    description: "Best for small parcels under 20 kg in dense urban traffic.",
    baseFare: 60,
    includedKm: 2,
    perKm: 10,
    longHaulPerKm: 8,
    minimumFare: 60,
    capacityKg: 20,
    freeWeightKg: 5,
    perKgOverFree: 4,
    icon: "moto",
    speedKph: 22,
    handlingMinutes: 8,
  },
  TRICYCLE: {
    id: "TRICYCLE",
    label: "Tricycle",
    description: "Classic Philippine short-hop ride for one or two passengers.",
    baseFare: 50,
    includedKm: 1,
    perKm: 12,
    longHaulPerKm: 10,
    minimumFare: 50,
    capacityKg: 50,
    freeWeightKg: 5,
    perKgOverFree: 3,
    icon: "tricycle",
    speedKph: 18,
    handlingMinutes: 6,
  },
  SEDAN: {
    id: "SEDAN",
    label: "Sedan",
    description: "Ideal for documents and boxed goods up to 200 kg.",
    baseFare: 130,
    includedKm: 2,
    perKm: 16,
    longHaulPerKm: 13,
    minimumFare: 130,
    capacityKg: 200,
    freeWeightKg: 20,
    perKgOverFree: 2.5,
    icon: "car",
    speedKph: 20,
    handlingMinutes: 10,
  },
  CLOSED_VAN: {
    id: "CLOSED_VAN",
    label: "Closed Van",
    description:
      "Weather-protected cargo up to 1,000 kg, perfect for retail and e-commerce.",
    baseFare: 600,
    includedKm: 3,
    perKm: 32,
    longHaulPerKm: 26,
    minimumFare: 600,
    capacityKg: 1000,
    freeWeightKg: 200,
    perKgOverFree: 0.9,
    icon: "van",
    speedKph: 18,
    handlingMinutes: 20,
  },
  FLATBED: {
    id: "FLATBED",
    label: "Flatbed",
    description: "Open-bed hauler for oversized cargo up to 5,000 kg.",
    baseFare: 1200,
    includedKm: 3,
    perKm: 55,
    longHaulPerKm: 45,
    minimumFare: 1200,
    capacityKg: 5000,
    freeWeightKg: 1000,
    perKgOverFree: 0.45,
    icon: "truck",
    speedKph: 16,
    handlingMinutes: 30,
  },
  REFRIGERATED: {
    id: "REFRIGERATED",
    label: "Refrigerated",
    description: "Cold-chain transport for groceries, pharma and perishables.",
    baseFare: 900,
    includedKm: 3,
    perKm: 48,
    longHaulPerKm: 40,
    minimumFare: 900,
    capacityKg: 2000,
    freeWeightKg: 300,
    perKgOverFree: 1.2,
    icon: "refrigerator",
    speedKph: 18,
    handlingMinutes: 25,
  },
};

export const VEHICLE_LIST = Object.values(VEHICLES);

export const BOOKING_STATUS_FLOW: BookingStatus[] = [
  "PENDING",
  "MATCHED",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Awaiting rider",
  MATCHED: "Rider matched",
  ACCEPTED: "Rider en route",
  PICKED_UP: "Package picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/**
 * Passenger-facing labels for RIDE bookings. The underlying status machine is
 * identical to deliveries, but the words should feel like a ride-hailing app,
 * not a freight tracker.
 */
export const RIDE_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Finding your driver",
  MATCHED: "Driver assigned",
  ACCEPTED: "Driver on the way",
  PICKED_UP: "On board",
  IN_TRANSIT: "Heading to drop-off",
  DELIVERED: "Ride completed",
  CANCELLED: "Cancelled",
};

export function statusLabel(
  status: BookingStatus,
  type: BookingType = "DELIVERY",
): string {
  return type === "RIDE" ? RIDE_STATUS_LABEL[status] : BOOKING_STATUS_LABEL[status];
}

export const BOOKING_TYPE_LABEL: Record<BookingType, string> = {
  DELIVERY: "Delivery",
  RIDE: "Ride",
};

/** Hard ceiling on surge, so a quote can never look predatory. */
export const MAX_SURGE_MULTIPLIER = 1.5;

/**
 * Surge multiplier based on the local day and hour.
 * Tuned to Philippine demand: the evening rush is the heaviest, Friday
 * evening is worse still, and Sunday daytime is quiet.
 */
export function computeSurgeMultiplier(date: Date = new Date()): number {
  const h = date.getHours();
  const day = date.getDay(); // 0 = Sunday, 5 = Friday

  let m = 1.0;
  if (h >= 7 && h <= 9)
    m = 1.25; // morning rush
  else if (h >= 17 && h <= 20)
    m = 1.35; // evening rush
  else if (h >= 22 || h <= 5) m = 1.15; // late-night scarcity

  if (day === 5 && h >= 17 && h <= 20) m += 0.15; // Friday payday crawl
  if (day === 0 && h >= 8 && h <= 16) m -= 0.1; // quiet Sunday daytime

  m = Math.min(MAX_SURGE_MULTIPLIER, Math.max(1.0, m));
  return Math.round(m * 100) / 100;
}

export const CURRENCY = "PHP";
export const CURRENCY_SYMBOL = "₱";