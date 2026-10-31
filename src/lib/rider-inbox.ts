import type { PrismaClient } from '@prisma/client';
export async function riderInbox(db: PrismaClient, userId: string) {
  const items = await db.customerNotification.findMany({ where: { customerId: userId, sourceId: { startsWith: 'rider:' } },
    select: { id: true, sourceId: true, bookingId: true, status: true, title: true, body: true, createdAt: true, readAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  return items.filter(item => item.bookingId).map(item => ({ id: 'server:' + item.id, serverId: item.id, bookingId: item.bookingId!,
    refCode: item.body.split(' · ')[0], title: item.title, body: item.body.split(' · ').slice(1).join(' · '),
    kind: item.sourceId.startsWith('rider:new:') ? 'new' : item.sourceId.startsWith('rider:cancelled:') ? 'cancelled' : 'offered',
    createdAt: item.createdAt.toISOString(), read: !!item.readAt, history: item.status === 'CANCELLED' }));
}
