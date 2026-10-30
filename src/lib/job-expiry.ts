import type { Prisma } from '@prisma/client';

export const REQUEST_WINDOW_MS = { RIDE: 10 * 60_000, DELIVERY: 30 * 60_000 } as const;
export const REQUEST_EXPIRED_REASON = 'Request expired: no rider accepted before the acceptance window ended. You can book again.';
type Request = { type: string; status: string; createdAt: Date | string; scheduledAt?: Date | string | null; pickedUpAt?: Date | null; paymentMethod?: string; customerPaidAt?: Date | null; riderReceivedAt?: Date | null; paymentStatus?: string };
export function requestExpiresAt(booking: Pick<Request, 'type' | 'createdAt' | 'scheduledAt'>) {
  const start = Math.max(new Date(booking.createdAt).getTime(), booking.scheduledAt ? new Date(booking.scheduledAt).getTime() : 0);
  return new Date(start + REQUEST_WINDOW_MS[booking.type === 'RIDE' ? 'RIDE' : 'DELIVERY']);
}
export function requestHasExpired(booking: Request, now = new Date()) {
  // Never expire accepted work or cash that participants have already recorded.
  return ['PENDING', 'MATCHED'].includes(booking.status) && !booking.pickedUpAt &&
    !(booking.paymentMethod === 'CASH' && (booking.customerPaidAt || booking.riderReceivedAt || booking.paymentStatus === 'PAID')) && requestExpiresAt(booking) <= now;
}
export function staleRequestWhere(now = new Date()): Prisma.BookingWhereInput {
  return { status: { in: ['PENDING', 'MATCHED'] }, pickedUpAt: null,
    NOT: { paymentMethod: 'CASH', OR: [{ customerPaidAt: { not: null } }, { riderReceivedAt: { not: null } }, { paymentStatus: 'PAID' }] },
    OR: (['RIDE', 'DELIVERY'] as const).map(type => {
      const cutoff = new Date(now.getTime() - REQUEST_WINDOW_MS[type]);
      return { type, createdAt: { lte: cutoff }, OR: [{ scheduledAt: null }, { scheduledAt: { lte: cutoff } }] };
    }),
  };
}
