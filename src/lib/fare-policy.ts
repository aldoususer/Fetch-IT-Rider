import type { VehicleClass, VehicleMeta } from "./pricing-defaults";
import { amountInCents, demoSplit, isDemoPayment } from "./payment-policy";

const LEGACY_FARE_POLICY_VERSION = "2026-11-12";
export const FARE_POLICY_VERSION = "2026-11-24";
export const BOOKING_FEES: Partial<Record<VehicleClass, number>> = {
  MOTORCYCLE: 5, TRICYCLE: 5, SEDAN: 10,
};

/** Passenger fares are independent of delivery weight and vehicle capacity. */
export const RIDE_RATES: Partial<Record<VehicleClass, Pick<VehicleMeta,
  "baseFare" | "minimumFare" | "includedKm" | "perKm" | "longHaulPerKm"
>>> = {
  MOTORCYCLE: { baseFare: 40, minimumFare: 40, includedKm: 2, perKm: 10, longHaulPerKm: 10 },
  TRICYCLE: { baseFare: 25, minimumFare: 25, includedKm: 3.5, perKm: 5, longHaulPerKm: 5 },
  SEDAN: { baseFare: 80, minimumFare: 80, includedKm: 2, perKm: 15, longHaulPerKm: 15 },
};

export type FareSnapshot = {
  pricingVersion: string;
  baseFare: number;
  distanceFare: number;
  weightFare: number;
  surgeFare: number;
  minimumAdjustment: number;
  roundingAdjustment?: number;
  transportFare: number;
  bookingFee: number;
  totalFare: number;
};

/** Only use complete snapshots whose components reconcile to the saved total. */
export function readFareSnapshot(value: unknown, total: unknown): FareSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fare = value as FareSnapshot;
  const legacy = fare.pricingVersion === LEGACY_FARE_POLICY_VERSION;
  if (!legacy && fare.pricingVersion !== FARE_POLICY_VERSION) return null;
  const components = [fare.baseFare, fare.distanceFare, fare.weightFare,
    fare.surgeFare, fare.minimumAdjustment];
  const amounts = [...components, fare.transportFare, fare.bookingFee, fare.totalFare];
  if (amounts.some(amount => typeof amount !== "number" || (amount !== 0 && amountInCents(amount) === null))) return null;

  // Historical totals include the original adjustment. New fares have no rounding line.
  const rounding = fare.roundingAdjustment ?? 0;
  if (legacy) {
    if (!amounts.every(Number.isSafeInteger) || !Number.isSafeInteger(fare.roundingAdjustment) || Math.abs(rounding) > 4) return null;
  } else if (fare.roundingAdjustment !== undefined) {
    return null;
  }

  const cents = (amount: number) => Math.round(amount * 100);
  const transportCents = components.reduce((sum, amount) => sum + cents(amount), cents(rounding));
  if (transportCents !== cents(fare.transportFare) ||
    transportCents + cents(fare.bookingFee) !== cents(fare.totalFare) ||
    fare.totalFare !== Number(total)) return null;
  return fare;
}

export function riderEarningsForBooking(booking: {
  totalFare: number; paymentMethod: string; fareBreakdown?: unknown;
  demoRiderEarnings?: number | null; demoCommissionBps?: number | null;
}): number {
  const fare = readFareSnapshot(booking.fareBreakdown, booking.totalFare);
  if (fare) return fare.transportFare;
  return isDemoPayment(booking.paymentMethod)
    ? booking.demoRiderEarnings ?? demoSplit(booking.totalFare.toFixed(2), booking.demoCommissionBps ?? 1500).riderEarnings
    : booking.totalFare;
}
