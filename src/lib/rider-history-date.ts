// Booking history uses the same Philippine calendar date as its displayed timestamp.
export function riderHistoryDateRange(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const midnight = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== value) return null;
  const gte = new Date(midnight.getTime() - 8 * 60 * 60 * 1000);
  return { gte, lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000) };
}

export type RiderHistoryDateBasis = 'created' | 'finished';
export function riderHistoryDateWhere(date: string, basis: RiderHistoryDateBasis) {
  const range = riderHistoryDateRange(date);
  if (!range) return null;
  return basis === 'finished'
    ? { OR: [{ status: 'DELIVERED' as const, deliveredAt: range }, { status: 'CANCELLED' as const, cancelledAt: range }] }
    : { createdAt: range };
}
