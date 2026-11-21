import type { Prisma } from "@prisma/client";

export const RIDE_DROPOFF_GRACE_MS = 3 * 60_000;

export function riderWorkInProgressWhere(now = new Date()): Prisma.BookingWhereInput {
  return {
    status: { in: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"] },
    OR: [
      { riderDropoffReportedAt: null },
      { riderDropoffReportedAt: { gt: new Date(now.getTime() - RIDE_DROPOFF_GRACE_MS) } },
    ],
  };
}

export function riderOccupancyWhere(now = new Date()): Prisma.BookingWhereInput {
  return { OR: [{ status: "MATCHED" }, riderWorkInProgressWhere(now)] };
}
