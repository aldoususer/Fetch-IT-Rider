// Device-only proof drafts. Never store pickup codes or location here.
export const PROOF_DRAFT_TTL = 24 * 60 * 60 * 1000;
export type ProofDraft = {
  ownerId: string; bookingId: string; savedAt: number;
  signatureSvg: string | null; photoDataUrl: string | null; photoName: string;
  recipientName: string; attemptKey: string | null;
};
let owner: string | null | undefined;
let epoch = 0;
let queue: Promise<unknown> = Promise.resolve();
const revisions = new Map<string, number>();
let activeBookings: Set<string> | null = null;
const key = (ownerId: string, bookingId: string) => JSON.stringify([ownerId, bookingId]);

// Serial transactions put cleanup after pending writes, including sign-out.
function transaction<T>(action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const run = () => new Promise<T>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Device storage unavailable')); return; }
    const request = indexedDB.open('fetchit-rider-proof-drafts', 1);
    let closed = false;
    const timeout = setTimeout(() => { closed = true; reject(new Error('Device storage timed out')); }, 3000);
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onsuccess = () => {
      if (closed) { request.result.close(); return; }
      clearTimeout(timeout);
      const db = request.result, tx = db.transaction('drafts', 'readwrite');
      let value: T;
      const deadline = setTimeout(() => tx.abort(), 3000);
      tx.oncomplete = () => { clearTimeout(deadline); db.close(); resolve(value); };
      tx.onabort = tx.onerror = () => { clearTimeout(deadline); db.close(); reject(tx.error ?? new Error('Device storage unavailable')); };
      try { action(tx.objectStore('drafts'), result => { value = result; }); }
      catch (failure) { tx.abort(); reject(failure); }
    };
  });
  const pending = queue.then(run, run);
  queue = pending.catch(() => {});
  return pending;
}

export function setProofDraftOwner(next: string | null) {
  if (next === owner) return;
  owner = next; epoch++; revisions.clear(); activeBookings = null;
  // A shared device must not expose another account's recipient details.
  void transaction<void>((store, done) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) { done(); return; }
      const draft = entry.value as ProofDraft;
      if (!next || draft.ownerId !== next || !validProofDraft(draft, next, draft.bookingId)) entry.delete();
      entry.continue();
    };
  }).catch(() => {});
}

export function validProofDraft(value: unknown, ownerId: string, bookingId: string, now = Date.now()): value is ProofDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ProofDraft;
  return d.ownerId === ownerId && d.bookingId === bookingId && Number.isFinite(d.savedAt)
    && now >= d.savedAt && now - d.savedAt < PROOF_DRAFT_TTL
    && (d.signatureSvg === null || typeof d.signatureSvg === 'string')
    && (d.photoDataUrl === null || /^data:image\/(jpeg|png|webp);base64,/.test(d.photoDataUrl))
    && typeof d.photoName === 'string' && typeof d.recipientName === 'string'
    && (d.attemptKey === null || typeof d.attemptKey === 'string');
}

export async function readProofDraft(ownerId: string, bookingId: string) {
  const current = epoch;
  return transaction<ProofDraft | null>((store, done) => {
    const request = store.get(key(ownerId, bookingId));
    request.onsuccess = () => {
      const value: unknown = request.result;
      if (current !== epoch || owner !== ownerId) { done(null); return; }
      if (!validProofDraft(value, ownerId, bookingId)) { store.delete(key(ownerId, bookingId)); done(null); }
      else done(value);
    };
  });
}

export async function saveProofDraft(draft: ProofDraft) {
  const current = epoch, id = key(draft.ownerId, draft.bookingId), revision = revisions.get(id);
  return transaction<boolean>((store, done) => {
    if (owner !== draft.ownerId || epoch !== current || revisions.get(id) !== revision || activeBookings && !activeBookings.has(draft.bookingId)) { done(false); return; }
    if (!validProofDraft(draft, draft.ownerId, draft.bookingId)) throw new Error('Invalid proof draft');
    store.put(draft, id); done(true);
  });
}

export function removeProofDraft(ownerId: string, bookingId: string) {
  const id = key(ownerId, bookingId);
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  return transaction<void>((store, done) => { store.delete(id); done(); });
}

// Call only with a complete, freshly confirmed active-job list.
export function retainActiveProofDrafts(ownerId: string, bookings: { id: string; riderId: string | null; status: string }[]) {
  const active = new Set(bookings.filter(b => b.riderId === ownerId && b.status === 'IN_TRANSIT').map(b => b.id));
  if (owner === ownerId) activeBookings = active;
  return transaction<void>((store, done) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) { done(); return; }
      const draft = entry.value as ProofDraft;
      if (draft.ownerId === ownerId && (!active.has(draft.bookingId) || !validProofDraft(draft, ownerId, draft.bookingId))) {
        const id = key(ownerId, draft.bookingId);
        revisions.set(id, (revisions.get(id) ?? 0) + 1);
        entry.delete();
      }
      entry.continue();
    };
  });
}
