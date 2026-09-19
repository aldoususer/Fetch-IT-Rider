// Haversine + fare utilities — pure functions shared by API and client.
//
// Pricing model (all amounts in PHP):
//
//   roadKm        = haversine(pickup, dropoff) * ROAD_DISTANCE_FACTOR
//   distanceFare  = km beyond the vehicle's includedKm, charged at perKm,
//                   stepping down to longHaulPerKm past LONG_HAUL_THRESHOLD_KM
//   weightFare    = kg above the vehicle's freeWeightKg, charged at perKgOverFree
//   surgeFare     = (surge - 1) * (base + distance + weight)
//   totalFare     = the above, raised to the vehicle's minimumFare if short
//
// Every component is rounded to whole pesos, and the components always add up
// to totalFare, so a receipt never looks off by a centavo.

import {
  VEHICLES,
  computeSurgeMultiplier,
  ROAD_DISTANCE_FACTOR,
  LONG_HAUL_THRESHOLD_KM,
  CURRENCY,
  type VehicleClass,
  type VehicleMeta,
} from "@/lib/constants";

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Billable distance: straight-line distance padded out to approximate the
 * road network. Replace this with a Directions API call when you have a
 * billing-enabled Google Maps key — the rest of the pricing is unaffected.
 */
export function roadDistanceKm(a: LatLng, b: LatLng): number {
  return round2(haversineKm(a, b) * ROAD_DISTANCE_FACTOR);
}

export interface FareInput {
  /** Billable road distance in km. */
  distanceKm: number;
  cargoWeightKg: number;
  surgeMultiplier: number;
  vehicle: VehicleMeta;
}

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  weightFare: number;
  surgeFare: number;
  /** Top-up applied when the trip falls under the vehicle's minimum fare. */
  minimumAdjustment: number;
  totalFare: number;
  /** Distance actually charged for, after the free allowance. km. */
  billableKm: number;
  /** Weight actually charged for, after the free allowance. kg. */
  chargeableKg: number;
  currency: string;
}

export function computeFare(input: FareInput): FareBreakdown {
  const v = input.vehicle;
  const distanceKm = Math.max(0, input.distanceKm);
  const weightKg = Math.max(0, Math.min(input.cargoWeightKg, v.capacityKg));

  // Distance: free allowance, then city rate, then long-haul rate.
  const billableKm = Math.max(0, distanceKm - v.includedKm);
  const cityKmCap = Math.max(0, LONG_HAUL_THRESHOLD_KM - v.includedKm);
  const cityKm = Math.min(billableKm, cityKmCap);
  const longHaulKm = billableKm - cityKm;
  const distanceFare = roundPeso(
    cityKm * v.perKm + longHaulKm * v.longHaulPerKm,
  );

  // Weight: free allowance, then a flat rate per extra kg.
  const chargeableKg = Math.max(0, weightKg - v.freeWeightKg);
  const weightFare = roundPeso(chargeableKg * v.perKgOverFree);

  const baseFare = roundPeso(v.baseFare);
  const subtotal = baseFare + distanceFare + weightFare;

  const surge = Math.max(1, input.surgeMultiplier);
  const surgeFare = roundPeso(subtotal * (surge - 1));
  const afterSurge = subtotal + surgeFare;

  const minimumAdjustment = Math.max(0, roundPeso(v.minimumFare) - afterSurge);
  const totalFare = afterSurge + minimumAdjustment;

  return {
    baseFare,
    distanceFare,
    weightFare,
    surgeFare,
    minimumAdjustment,
    totalFare,
    billableKm: round2(billableKm),
    chargeableKg: round2(chargeableKg),
    currency: CURRENCY,
  };
}

function roundPeso(n: number): number {
  return Math.round(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Travel time plus the vehicle's loading / paperwork overhead. */
export function etaMinutes(
  distanceKm: number,
  speedKph: number,
  handlingMinutes = 0,
): number {
  if (speedKph <= 0) return Math.max(1, Math.round(handlingMinutes));
  const travel = (distanceKm / speedKph) * 60;
  return Math.max(1, Math.round(travel + handlingMinutes));
}

export interface Quote {
  distanceKm: number;
  straightLineKm: number;
  surgeMultiplier: number;
  fare: FareBreakdown;
  etaMinutes: number;
  vehicle: VehicleMeta;
}

/**
 * Single source of truth for pricing. Both /api/fare/estimate and the booking
 * creation route call this, so the quote a customer sees is exactly the amount
 * that gets written to the booking.
 */
export function quoteFare(params: {
  pickup: LatLng;
  dropoff: LatLng;
  vehicleClass: VehicleClass;
  cargoWeightKg: number;
  when?: Date;
}): Quote {
  const vehicle = VEHICLES[params.vehicleClass];
  const straightLineKm = round2(haversineKm(params.pickup, params.dropoff));
  const distanceKm = roadDistanceKm(params.pickup, params.dropoff);
  const surgeMultiplier = computeSurgeMultiplier(params.when ?? new Date());

  const fare = computeFare({
    distanceKm,
    cargoWeightKg: params.cargoWeightKg,
    surgeMultiplier,
    vehicle,
  });

  return {
    distanceKm,
    straightLineKm,
    surgeMultiplier,
    fare,
    etaMinutes: etaMinutes(distanceKm, vehicle.speedKph, vehicle.handlingMinutes),
    vehicle,
  };
}

export function generateRefCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "FIT-";
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}