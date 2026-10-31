export type AlertJob = { id: string; refCode: string; type: string; status: string; createdAt: string; updatedAt: string; scheduledAt: string | null };
export type RiderAlert = { id: string; bookingId: string; refCode: string; title: string; body: string; createdAt: string; read: boolean; history: boolean; kind?: string; serverId?: string };
export type AlertSnapshot = { checkedAt: string; available: AlertJob[]; assigned: AlertJob[]; notifications?: RiderAlert[] };
export type AlertState = { startedAt: string; checkedAt: string; available: string[]; statuses: Record<string, string>; seen: string[]; items: RiderAlert[] };
export function readRiderAlertState(value: unknown): AlertState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as AlertState;
  const text = (item: unknown) => typeof item === 'string' && item.length <= 500;
  if (!text(state.startedAt) || !text(state.checkedAt) || !Number.isFinite(Date.parse(state.startedAt)) || !Number.isFinite(Date.parse(state.checkedAt)) ||
      !Array.isArray(state.available) || !state.available.every(text) || !Array.isArray(state.seen) || !state.seen.every(text) ||
      !state.statuses || typeof state.statuses !== 'object' || !Object.values(state.statuses).every(text) || !Array.isArray(state.items) ||
      !state.items.every(item => item && [item.id, item.bookingId, item.refCode, item.title, item.body, item.createdAt].every(text) && (item.serverId === undefined || text(item.serverId)) && (item.kind === undefined || text(item.kind)) && Number.isFinite(Date.parse(item.createdAt)) && typeof item.read === 'boolean' && typeof item.history === 'boolean')) return null;
  return { ...state, available: state.available.slice(-400), seen: state.seen.slice(-600), items: state.items.slice(0, 100) };
}
export function advanceRiderAlerts(previous: AlertState | null, snapshot: AlertSnapshot): { state: AlertState; added: RiderAlert[] } {
  if (previous && Date.parse(snapshot.checkedAt) < Date.parse(previous.checkedAt)) return { state: previous, added: [] };
  const now = Date.parse(snapshot.checkedAt), added: RiderAlert[] = [], seen = new Set(previous?.seen ?? []);
  const add = (job: AlertJob, kind: string, title: string, body: string) => {
    const id = `${job.id}:${kind}`;
    if (!seen.has(id)) { seen.add(id); added.push({ id, bookingId: job.id, refCode: job.refCode, title, body, createdAt: snapshot.checkedAt, read: false, history: job.status === 'CANCELLED', kind: kind.startsWith('offer:') ? 'offered' : kind }); }
  };
  if (previous) {
    for (const job of snapshot.available) {
      const scheduled = Date.parse(job.scheduledAt ?? ''), future = scheduled > now;
      if (!previous.available.includes(job.id) && Date.parse(job.createdAt) > Date.parse(previous.startedAt) && !future)
        add(job, 'new', job.type === 'RIDE' ? 'New ride request' : 'New delivery request', 'Review the route and fare before accepting.');
      if (job.status === 'MATCHED' && previous.statuses[job.id] !== 'MATCHED' && Date.parse(job.updatedAt) > Date.parse(previous.checkedAt))
        add(job, `offer:${job.updatedAt}`, 'A job was offered to you', 'Review this offer before it expires.');
      if (future && scheduled - now <= 10 * 60_000 && previous.available.includes(job.id))
        add(job, `soon:${job.scheduledAt}`, 'Scheduled pickup soon', 'Pickup is within 10 minutes. This is an open request; acceptance opens at pickup time.');
      if (Number.isFinite(scheduled) && scheduled <= now && scheduled > Date.parse(previous.checkedAt) && previous.available.includes(job.id))
        add(job, `due:${job.scheduledAt}`, 'Scheduled request is available', 'Pickup time has arrived. Review the request before accepting.');
    }
    for (const job of snapshot.assigned) {
      if (job.status === 'CANCELLED' && previous.statuses[job.id] !== 'CANCELLED' &&
          (previous.statuses[job.id] || Date.parse(job.updatedAt) > Date.parse(previous.checkedAt)))
        add(job, 'cancelled', 'Booking cancelled', 'This booking has ended. Do not continue to pickup.');
    }
  }
  return { added, state: { startedAt: previous?.startedAt ?? snapshot.checkedAt, checkedAt: snapshot.checkedAt,
    available: snapshot.available.map(job => job.id), statuses: Object.fromEntries([...snapshot.available, ...snapshot.assigned].map(job => [job.id, job.status])),
    seen: [...seen].slice(-600), items: [...added, ...(previous?.items ?? [])].slice(0, 100) } };
}

export function riderAlertIdentity(item: RiderAlert) {
  const kind = item.kind ?? (item.id.endsWith(':new') ? 'new' : item.id.endsWith(':cancelled') ? 'cancelled' : item.id.includes(':offer:') ? 'offered' : item.id);
  return item.bookingId + ':' + kind;
}
export function mergeRiderInbox(current: RiderAlert[], server: RiderAlert[]) {
  const identities = new Set(server.map(riderAlertIdentity)), acknowledge: string[] = [];
  const items = server.map(item => {
    const previous = current.find(saved => saved.id === item.id || (!saved.serverId && riderAlertIdentity(saved) === riderAlertIdentity(item)));
    if (previous?.read && !item.read && item.serverId) acknowledge.push(item.serverId);
    return previous?.read ? { ...item, read: true } : item;
  });
  items.push(...current.filter(item => !item.serverId && !identities.has(riderAlertIdentity(item))));
  return { items: items.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,100), acknowledge };
}
