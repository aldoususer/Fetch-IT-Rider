import type { PrismaClient } from '@prisma/client';

export class ReviewPageError extends Error {}
export async function getRiderReviews(db: Pick<PrismaClient, 'customerReview'>, riderId: string, cursor: string | null) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(cursor)) throw new ReviewPageError('Refresh reviews and try again.');
  const previous = cursor ? await db.customerReview.findFirst({ where: { id: cursor, riderId }, select: { id: true, createdAt: true } }) : null;
  if (cursor && !previous) throw new ReviewPageError('Refresh reviews and try again.');
  const rows = await db.customerReview.findMany({
    where: { riderId, ...(previous ? { OR: [{ createdAt: { lt: previous.createdAt } }, { createdAt: previous.createdAt, id: { lt: previous.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 11,
    select: { id: true, rating: true, comment: true, createdAt: true, booking: { select: { type: true } } },
  });
  const page = rows.slice(0, 10);
  return { reviews: page.map(row => ({ id: row.id, rating: row.rating, comment: row.comment, createdAt: row.createdAt.toISOString(), service: row.booking.type })), nextCursor: rows.length > 10 ? page.at(-1)!.id : null };
}
