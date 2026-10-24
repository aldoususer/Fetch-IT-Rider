import type { Prisma } from "@prisma/client";

export function validOperatingZone(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length >= 4 && value.length <= 100 && value.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) && value[0][0] === value[value.length - 1][0] && value[0][1] === value[value.length - 1][1] && Math.abs(value.slice(1).reduce((area, p, i) => area + value[i][0] * p[1] - p[0] * value[i][1], 0)) > 0.00000001;
}
export function insideOperatingZone(lng: number, lat: number, zone: number[][]) {
  let inside = false;
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const [xi, yi] = zone[i], [xj, yj] = zone[j];
    const cross = (lat - yi) * (xj - xi) - (lng - xi) * (yj - yi);
    if (Math.abs(cross) < 1e-10 && lng >= Math.min(xi, xj) && lng <= Math.max(xi, xj) && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function approvalCoversRoute(approval: { source: string; operatingZone?: unknown }, booking: { vehicleClass: string; type: string; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number }) {
  if (booking.vehicleClass !== "TRICYCLE" || booking.type !== "RIDE" || approval.source === "LEGACY_EXISTING") return true;
  return validOperatingZone(approval.operatingZone) && insideOperatingZone(booking.pickupLng, booking.pickupLat, approval.operatingZone) && insideOperatingZone(booking.dropoffLng, booking.dropoffLat, approval.operatingZone);
}

export function liveApprovalWhere(now = new Date()): Prisma.RiderServiceApprovalWhereInput {
  return { revokedAt: null, OR: [{ validUntil: null }, { validUntil: { gt: now } }] };
}
export async function approvedServices(tx: Pick<Prisma.TransactionClient, "riderServiceApproval">, userId: string, vehicleClass?: string) {
  const approvals = await tx.riderServiceApproval.findMany({ where: { userId, ...(vehicleClass ? { vehicleClass: vehicleClass as "MOTORCYCLE" } : {}), ...liveApprovalWhere() }, select: { service: true } });
  return [...new Set(approvals.map(a => a.service))];
}
export async function riderCanTakeBooking(tx: Pick<Prisma.TransactionClient, "riderServiceApproval">, userId: string, booking: { vehicleClass: string; type: string; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number }) {
  const approval = await tx.riderServiceApproval.findFirst({ where: { userId, vehicleClass: booking.vehicleClass as "TRICYCLE", service: booking.type as "RIDE", ...liveApprovalWhere() } });
  return !!approval && approvalCoversRoute(approval, booking);
}
