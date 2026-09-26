// Rider-only tracking tickets.
//
// A "ticket" is a short, human-typed job id — R0001 for a ride, D0001 for a
// delivery, sequential per type — plus (once encoded) a compact snapshot of
// the order. Riders copy the encoded string out of this PWA and paste it
// into the companion native app, which can run background GPS the way a
// website can't. The native app decodes the snapshot to show the job
// immediately, then POSTs live location to the rider-authenticated
// `/api/native/tickets/{ticketId}/location` endpoint.
//
// Ticket ids/payloads are never sent to the customer app or shown to
// customers — see the strip helpers below, used everywhere a Booking is
// returned from a customer-facing route.
//
// This file is duplicated (kept byte-for-byte identical) across the
// customer, rider and admin apps since they don't share a package — only a
// database. If you change the payload shape here, mirror the change in the
// other two apps' src/lib/ticket.ts, bump TICKET_SCHEMA_VERSION, and keep
// decodeTicket() able to read the previous version for tickets already
// handed out.

import type { Prisma, PrismaClient } from "@prisma/client";

export const TICKET_PREFIX = { RIDE: "R", DELIVERY: "D" } as const;
export type TicketType = keyof typeof TICKET_PREFIX;

const TICKET_SCHEMA_VERSION = 1;

/**
 * Atomically reserves the next sequential number for `type` (RIDE/DELIVERY)
 * and returns a formatted ticket id, e.g. "R0001", "D0042".
 *
 * Uses a raw INSERT ... ON CONFLICT DO UPDATE ... RETURNING so Postgres
 * itself serializes concurrent callers — two bookings created at the same
 * instant still get distinct, gapless numbers. Pass a `tx` (from
 * `db.$transaction`) when generating a ticket alongside a booking.create so
 * both happen atomically together.
 */
export async function generateTicketId(
  tx: PrismaClient | Prisma.TransactionClient,
  type: TicketType,
): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "TicketCounter" ("type", "value")
    VALUES (${type}, 1)
    ON CONFLICT ("type")
    DO UPDATE SET "value" = "TicketCounter"."value" + 1
    RETURNING "value";
  `;
  const seq = rows[0]?.value ?? 1;
  return `${TICKET_PREFIX[type]}${String(seq).padStart(4, "0")}`;
}

/** Everything the native app needs to show the job without another API call. */
export interface TicketOrderSnapshot {
  ticketId: string;
  bookingId: string;
  type: TicketType;
  status: string;
  customer: { name: string; phone: string | null };
  rider: {
    name: string;
    phone: string | null;
    vehicleClass: string | null;
    vehiclePlate: string | null;
  } | null;
  pickup: { label: string; lat: number; lng: number };
  dropoff: { label: string; lat: number; lng: number };
  vehicleClass: string;
  cargoWeightKg: number;
  passengers: number;
  cargoNotes: string | null;
  distanceKm: number;
  totalFare: number;
  currency: string;
  scheduledAt: string | null;
  createdAt: string;
}

// Minimal shape encode/build need — matches what every route already
// fetches via `include: { customer: {...}, rider: {...} }`.
export interface BookingForTicket {
  id: string;
  ticketId: string | null;
  type: string;
  status: string;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLabel: string;
  dropoffLat: number;
  dropoffLng: number;
  vehicleClass: string;
  cargoWeightKg: number;
  passengers: number;
  cargoNotes: string | null;
  distanceKm: number;
  totalFare: number;
  currency: string;
  scheduledAt: Date | string | null;
  createdAt: Date | string;
  customer: { name: string; phone: string | null };
  rider?: {
    name: string;
    phone: string | null;
    vehicleClass: string | null;
    vehiclePlate: string | null;
  } | null;
}

export function buildTicketSnapshot(
  booking: BookingForTicket,
): TicketOrderSnapshot | null {
  if (!booking.ticketId) return null;
  return {
    ticketId: booking.ticketId,
    bookingId: booking.id,
    type: booking.type === "RIDE" ? "RIDE" : "DELIVERY",
    status: booking.status,
    customer: { name: booking.customer.name, phone: booking.customer.phone },
    rider: booking.rider
      ? {
          name: booking.rider.name,
          phone: booking.rider.phone,
          vehicleClass: booking.rider.vehicleClass,
          vehiclePlate: booking.rider.vehiclePlate,
        }
      : null,
    pickup: { label: booking.pickupLabel, lat: booking.pickupLat, lng: booking.pickupLng },
    dropoff: { label: booking.dropoffLabel, lat: booking.dropoffLat, lng: booking.dropoffLng },
    vehicleClass: booking.vehicleClass,
    cargoWeightKg: booking.cargoWeightKg,
    passengers: booking.passengers,
    cargoNotes: booking.cargoNotes,
    distanceKm: booking.distanceKm,
    totalFare: booking.totalFare,
    currency: booking.currency,
    scheduledAt: booking.scheduledAt ? new Date(booking.scheduledAt).toISOString() : null,
    createdAt: new Date(booking.createdAt).toISOString(),
  };
}

function toBase64Url(json: string): string {
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf-8").toString("base64")
      : btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): string {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const base64 = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "=");
  return typeof Buffer !== "undefined"
    ? Buffer.from(base64, "base64").toString("utf-8")
    : decodeURIComponent(escape(atob(base64)));
}

/**
 * Packs an order snapshot into one copy-pasteable string:
 *   FIT1:R0001:<base64url JSON>
 * The "FIT1:R0001:" prefix keeps the ticket id human-readable at a glance
 * (e.g. in a support chat) even before the native app decodes the rest.
 */
export function encodeTicket(snapshot: TicketOrderSnapshot): string {
  return `FIT${TICKET_SCHEMA_VERSION}:${snapshot.ticketId}:${toBase64Url(JSON.stringify(snapshot))}`;
}

const TICKET_RE = /^FIT(\d+):([A-Z]\d{4,}):([A-Za-z0-9_-]+)$/;

export function decodeTicket(ticket: string): TicketOrderSnapshot | null {
  const match = ticket.trim().match(TICKET_RE);
  if (!match) return null;
  try {
    return JSON.parse(fromBase64Url(match[3])) as TicketOrderSnapshot;
  } catch {
    return null;
  }
}

/** Strip the rider-only fields before a booking is sent to a customer. */
export function omitTicket<T extends { ticketId?: unknown }>(
  booking: T,
): Omit<T, "ticketId"> {
  const { ticketId: _ticketId, ...rest } = booking;
  return rest;
}
