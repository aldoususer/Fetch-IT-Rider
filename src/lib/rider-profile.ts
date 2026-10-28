import type { PrismaClient } from "@prisma/client";
import { liveApprovalWhere } from "./rider-eligibility";

export async function getRiderProfile(db: PrismaClient, riderId: string) {
  const [rider, ratings, completedBookings, approvals] = await Promise.all([
    db.user.findUnique({ where: { id: riderId }, select: { name: true, role: true, createdAt: true, riderProfile: { select: { vehicleClass: true, vehiclePlate: true } } } }),
    db.customerReview.aggregate({ where: { riderId }, _avg: { rating: true }, _count: { rating: true } }),
    db.booking.count({ where: { riderId, status: "DELIVERED" } }),
    db.riderServiceApproval.findMany({ where: { userId: riderId, ...liveApprovalWhere() }, select: { service: true } }),
  ]);
  if (!rider || rider.role !== "RIDER") return null;
  return { name: rider.name, memberSince: rider.createdAt.toISOString(), vehicleClass: rider.riderProfile?.vehicleClass ?? null,
    vehiclePlate: rider.riderProfile?.vehiclePlate ?? null, rating: ratings._avg.rating, ratingCount: ratings._count.rating,
    completedBookings, services: [...new Set(approvals.map(item => item.service))] };
}
