import type { PrismaClient } from '@prisma/client';

export type NoticeActor = { id: string; role: string };
export type NoticeView = 'personal' | 'team' | 'general' | 'platform';
export type Notice = { id: string; title: string; detail: string; at: string; href: string; read: boolean; urgent: boolean; entityType: string; entityId: string; claim?: {kind:"support"|"case"|"application";revision:string;endpoint:string} };

export function noticeView(value: string | null, role: string): NoticeView {
  if (value === 'platform' && role === 'SUPERADMIN') return value;
  if (value === 'general' || value === 'personal') return value;
  if (value === 'team' && role !== 'SUPERADMIN') return value;
  return role === 'SUPERADMIN' ? 'platform' : 'personal';
}

export function noticeHref(entity: string, id: string) {
  const encoded = encodeURIComponent(id);
  if (entity === 'SUPPORT') return `/dashboard/support/${encoded}`;
  if (entity === 'CASE') return `/dashboard/cases/${encoded}`;
  if (entity === 'PAYMENT') return `/dashboard/bookings/${encoded}`;
  if (entity === 'APPLICATION') return `/dashboard/applications/${encoded}`;
  if (entity === 'SECURITY') return '/dashboard/account';
  if (entity === 'RESOURCE') return '/dashboard/resources';
  return '/dashboard/incidents';
}

// Recipients are selected again against current ownership and permissions. A
// reassigned/restricted record cannot leak through an older persisted notice.
export async function notificationFeed(db: PrismaClient, actor: NoticeActor, view: NoticeView, before?: string) {
  if (before && !Number.isFinite(Date.parse(before))) throw new Error('Invalid notification cursor.');
  const rows = await db.$queryRaw<(Omit<Notice, 'at' | 'href'> & { createdAt: Date; claimKind: string | null; revision: string | null })[]>`
    SELECT * FROM (SELECT DISTINCT ON(n."entityType",n."entityId",CASE WHEN n."entityType"='SECURITY' THEN n.id ELSE '' END)
      n.id,n.title,n.detail,n."entityType",n."entityId",n."createdAt",(n.urgent AND (c.id IS NULL OR c.status<>'RESOLVED')) AS urgent,r."readAt" IS NOT NULL AS read,
      CASE WHEN n.channel='TEAM' AND n."entityType"='SUPPORT' AND t."assignedAdminId" IS NULL THEN 'support'
        WHEN n.channel='TEAM' AND n."entityType"='CASE' AND c."assignedToId" IS NULL AND c.status IN ('OPEN','IN_REVIEW') THEN 'case'
        WHEN n.channel='TEAM' AND n."entityType"='APPLICATION' AND a."assignedToId" IS NULL AND a.status IN ('SUBMITTED','IN_REVIEW') THEN 'application' END AS "claimKind",
      CASE n."entityType" WHEN 'SUPPORT' THEN t."updatedAt"::text WHEN 'CASE' THEN c.version::text WHEN 'APPLICATION' THEN a.version::text END AS revision
    FROM "StaffNotice" n
    LEFT JOIN "StaffNoticeRead" r ON r."noticeId"=n.id AND r."actorId"=${actor.id}
    LEFT JOIN "SupportTicket" t ON n."entityType"='SUPPORT' AND t.id=n."entityId"
    LEFT JOIN "WorkflowCase" c ON n."entityType"='CASE' AND c.id=n."entityId"
    LEFT JOIN "RiderApplication" a ON n."entityType"='APPLICATION' AND a.id=n."entityId"
    LEFT JOIN "Booking" b ON n."entityType"='PAYMENT' AND b.id=n."entityId"
    LEFT JOIN "PlatformIncident" i ON n."entityType"='INCIDENT' AND i.id=n."entityId"
    WHERE n.channel=${view.toUpperCase()}
    AND (${before ?? null}::timestamp IS NULL OR n."createdAt" < ${before ?? null}::timestamp)
    AND (n."createdAt">CURRENT_TIMESTAMP-INTERVAL '30 days' OR n.channel='TEAM' OR n.urgent AND c.status<>'RESOLVED' OR i.active)
    AND (n."recipientId" IS NULL OR n."recipientId"=${actor.id})
    AND (n."recipientRole" IS NULL OR n."recipientRole"=${actor.role}
      OR n.channel='TEAM' AND ${actor.role}='ADMIN' AND n."recipientRole" IN ('SUPPORT','SUPPORT_SUPERVISOR','SAFETY')
      OR n.channel='GENERAL' AND ${actor.role}='SUPERADMIN')
    AND (n.channel<>'PLATFORM' OR ${actor.role}='SUPERADMIN')
    AND (n.channel<>'TEAM' OR ${actor.role}<>'SUPERADMIN')
    AND (n."entityType"<>'SECURITY' OR n."recipientId"=${actor.id})
    AND (n."entityType"<>'SUPPORT' OR t.id IS NOT NULL AND NOT t."isEmergency" AND ${actor.role} IN ('SUPPORT','SUPPORT_SUPERVISOR','ADMIN','SUPERADMIN') AND (
      n.channel='TEAM' AND t."assignedAdminId" IS NULL AND t.status<>'RESOLVED'
      OR n.channel='PERSONAL' AND (t."assignedAdminId"=${actor.id} OR ${actor.role} IN ('ADMIN','SUPPORT_SUPERVISOR','SUPERADMIN'))))
    AND (n."entityType"<>'CASE' OR c.id IS NOT NULL AND (
      n.channel='TEAM' AND (c."assignedToId" IS NULL AND c.status IN ('OPEN','IN_REVIEW')
        OR c.status='AWAITING_ADMIN' AND ${actor.role}='ADMIN' AND c."createdById"<>${actor.id} AND coalesce(c."assignedToId",'')<>${actor.id}
        OR n.id LIKE 'emergency-backup:%' AND c."acknowledgedAt" IS NULL AND c.status<>'RESOLVED')
      OR n.channel='PERSONAL' AND (c."createdById"=${actor.id} OR ${actor.role} IN ('ADMIN','SUPERADMIN') OR c."assignedToId"=${actor.id} AND (c.kind='SAFETY' AND ${actor.role}='SAFETY' OR c.kind='ESCALATION' AND ${actor.role}='SUPPORT_SUPERVISOR'))))
    AND (n."entityType"<>'APPLICATION' OR a.id IS NOT NULL AND ${actor.role} IN ('SAFETY','ADMIN','SUPERADMIN') AND (
      n.channel='PERSONAL' AND a."assignedToId"=${actor.id}
      OR n.channel='TEAM' AND a."assignedToId" IS NULL AND a.status IN ('SUBMITTED','IN_REVIEW')
      OR n.channel='TEAM' AND a.status='FORCE_APPROVAL_PENDING' AND ${actor.role}='ADMIN' AND coalesce((SELECT e."actorId" FROM "RiderApplicationEvent" e WHERE e."applicationId"=a.id AND e.action='FORCE_APPROVAL_REQUESTED' ORDER BY e."createdAt" DESC LIMIT 1),'')<>${actor.id}))
    AND (n."entityType"<>'PAYMENT' OR ${actor.role} IN ('ADMIN','SUPERADMIN') AND b.id IS NOT NULL AND b."paymentMethod"='CASH' AND b."paymentStatus"='PENDING'
      AND b."customerPaidAmount" IS NOT NULL AND b."riderReceivedAmount" IS NOT NULL AND (b."customerPaidAmount"<>b."totalFare" OR b."riderReceivedAmount"<>b."totalFare"))
    AND (n."entityType"<>'INCIDENT' OR i.id IS NOT NULL AND (n.channel<>'TEAM' OR i.active))
    ORDER BY n."entityType",n."entityId",CASE WHEN n."entityType"='SECURITY' THEN n.id ELSE '' END,n."createdAt" DESC,(n.id LIKE 'case:%') DESC,n.id DESC) visible
    ORDER BY urgent DESC,"createdAt" DESC,id DESC LIMIT 200`;
  // Keep the most recent event per record in this view. Explicit security events
  // are kept separately; read state belongs to immutable event IDs.
  const seen = new Set<string>();
  const items: Notice[] = [];
  for (const row of rows) {
    const key = row.entityType === 'SECURITY' ? row.id : `${row.entityType}:${row.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id: row.id, title: row.title, detail: row.detail, at: row.createdAt.toISOString(),
      href: row.entityType === 'SECURITY' && actor.role === 'SUPERADMIN' ? '/dashboard/security' : noticeHref(row.entityType, row.entityId),
      read: row.read, urgent: row.urgent, entityType: row.entityType, entityId: row.entityId,
      ...(row.claimKind && row.revision ? {claim:{kind:row.claimKind as "support"|"case"|"application",revision:row.claimKind==='support'?new Date(row.revision+'Z').toISOString():row.revision,endpoint:`/api/${row.claimKind==='support'?'support':row.claimKind==='case'?'cases':'rider-applications'}/${encodeURIComponent(row.entityId)}`}} : {}) });
  }
  return { items, checkedAt: new Date().toISOString() };
}

export async function readNotifications(db: PrismaClient, actor: NoticeActor, view: NoticeView, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || id.length > 300)) throw new Error('Choose up to 200 notifications.');
  // Never trust IDs supplied by the client, including another staff member's.
  const visible = await notificationFeed(db, actor, view);
  const allowed = new Set(visible.items.map(item => item.id));
  const selected = [...new Set(ids as string[])].filter(id => allowed.has(id));
  if (selected.length !== new Set(ids).size) throw new Error('These notifications are no longer available in your feed. Refresh and retry.');
  await db.staffNoticeRead.createMany({ data: selected.map(noticeId => ({ noticeId, actorId: actor.id })), skipDuplicates: true });
  return { message: 'Marked as read. Ownership and work status are unchanged.' };
}

export type MonitorDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
export async function recordServiceHealth(db: MonitorDb, scope: string, status: number) {
  const service = scope.includes('road-route') ? 'ROAD_ROUTING' : /bookings/.test(scope) ? 'BOOKING_API' : null;
  if (!service || status >= 400 && status < 500) return;
  await db.$executeRaw`SELECT fetch_record_service_health(${service},${status >= 500})`;
}
export async function refreshOperationalSignals(db: MonitorDb) {
  await db.$executeRaw`SELECT fetch_refresh_operational_signals()`;
}
