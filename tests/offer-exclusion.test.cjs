const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, deps = {}, clock = Date) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date: clock, Math, Set, Promise, process: { env: {} }, require: name => { if (!(name in deps)) throw Error(name); return deps[name]; } }); return exports; }
const roads = load('src/lib/road-routing.ts'), policy = load('src/lib/matching-policy.ts', { './road-routing': roads }), platform = load('src/lib/platform-policy.ts', { './pricing-defaults': load('src/lib/pricing-defaults.ts') });
function harness({ status = 'MATCHED', phase = 'OFFERED', attempts = 3, excluded = ['declined'], riders = [], expired = true, type = 'RIDE', clock = Date } = {}) {
 const booking = { id: 'booking', vehicleClass: 'SEDAN', type, status, riderId: status === 'MATCHED' ? 'missed' : null, pickupLat: 16.0206, pickupLng: 120.2321, paymentMethod: 'CASH', excludedRiderIds: [...excluded], assignmentExpiresAt: new Date(clock.now() + (expired ? -1000 : 45000)), updatedAt: new clock() };
 const dispatch = { phase, attempts, workerToken: 'worker', workerUntil: new Date(clock.now() + 60000) }, events = [], tasks = [], reservations = [], completionFilters = [];
 const tx = { $queryRaw: async () => [], platformConfig: { findUnique: async () => null }, booking: { findUnique: async () => booking, update: async ({ data }) => Object.assign(booking, data) }, autoDispatch: { findUnique: async () => dispatch, update: async ({ data }) => { for (const [key, value] of Object.entries(data)) dispatch[key] = value?.increment ? dispatch[key] + value.increment : value; return dispatch; } }, riderPresence: { findUnique: async ({ where }) => riders.find(r => r.id === where.userId)?.riderPresence, update: async () => ({}) }, customerPushSubscription: { findFirst: async () => ({ id: 'sub' }) } };
 const db = { ...tx, $transaction: fn => fn(tx), user: { findMany: async ({ where, select }) => {
  const filter = select._count.select.bookingsAsRider.where;
  completionFilters.push(filter);
  return riders.filter(r => !where.id.notIn.includes(r.id)).map(r => ({
   ...r, _count: { bookingsAsRider: (r.history ?? []).filter(job => job.status === filter.status
    && (!filter.type || job.type === filter.type)
    && (!filter.deliveredAt || job.deliveredAt >= filter.deliveredAt.gte && job.deliveredAt < filter.deliveredAt.lt)).length },
  }));
 } } };
 const api = load('src/lib/automatching.ts', { './eta-policy': {}, './road-routing': roads, 'node:crypto': require('node:crypto'), './matching-policy': load('src/lib/matching-policy.ts', { './road-routing': roads }, clock), './rider-eligibility': { liveApprovalWhere: () => ({}), approvalCoversRoute: () => true }, './platform-policy': platform, './job-expiry': { requestHasExpired: () => false }, './rider-cancellation-policy': require('./helpers/cancellation-policy.cjs'), './road-routing-service': { routingEnabled: () => false }, './dispatch': { reserveAvailableRider: async (_, id) => reservations.push(id) }, './booking-events': { recordBookingEvent: async (...args) => events.push(args[3]) }, './rider-push-tasks': { queueRiderPushTask: async (...args) => tasks.push(args) } }, clock);
 return { booking, dispatch, events, tasks, reservations, completionFilters, run: () => api.advanceAutomaticMatching(db, booking.id, 'worker') };
}
const rider = id => ({ id, riderPresence: { isOnline: true, lat: 16.0206, lng: 120.2321, locationAt: new Date(), locationAccuracy: 10, onlineAt: new Date(Date.now() - 60000), lastOfferAt: null }, riderApprovals: [{}], pushSubscriptions: [{}] });
test('default offer window remains 45 seconds', () => assert.equal(platform.defaultPlatformSettings().matchingOfferSeconds, 45));
test('last expired offer opens only to other riders and preserves all previous exclusions', async () => {
 const h = harness(); await h.run(); assert.equal(h.dispatch.phase, 'OPEN'); assert.equal(h.booking.status, 'PENDING'); assert.equal(h.booking.riderId, null); assert.deepEqual(Array.from(h.booking.excludedRiderIds), ['declined', 'missed']); assert.equal(h.tasks.length, 1);
 await h.run(); assert.equal(h.tasks.length, 1); assert.deepEqual(Array.from(h.booking.excludedRiderIds), ['declined', 'missed']);
});
test('no remaining candidates cannot clear an earlier decline', async () => { const h = harness({ status: 'PENDING', phase: 'SEARCHING', attempts: 1 }); await h.run(); assert.equal(h.dispatch.phase, 'OPEN'); assert.deepEqual(Array.from(h.booking.excludedRiderIds), ['declined']); });
test('an expired offer transfers to another rider for 45 seconds and excludes the previous one', async () => {
 const h = harness({ attempts: 1, riders: [rider('missed'), rider('next')] }); const start = Date.now(); await h.run(); assert.equal(h.booking.riderId, 'next'); assert.equal(h.booking.status, 'MATCHED'); assert.equal(h.dispatch.phase, 'OFFERED'); assert.deepEqual(h.reservations, ['next']); assert(h.booking.assignmentExpiresAt.getTime() >= start + 45000); assert(h.booking.assignmentExpiresAt.getTime() <= Date.now() + 45000); assert(h.booking.excludedRiderIds.includes('missed'));
});
test('unexpired offers and cancelled jobs cannot be reassigned', async () => { const waiting = harness({ expired: false }), cancelled = harness({ status: 'CANCELLED' }); await waiting.run(); await cancelled.run(); assert.equal(waiting.booking.riderId, 'missed'); assert.equal(waiting.tasks.length, 0); assert.equal(cancelled.dispatch.phase, 'DONE'); assert.equal(cancelled.tasks.length, 0); });
test('delivery offers rank by completed deliveries since Philippine midnight, while passenger rides keep the existing count', async () => {
 async function offer(type, time) {
  const timestamp = Date.parse(time);
  class Clock extends Date {
   constructor(...args) { super(...(args.length ? args : [timestamp])); }
   static now() { return timestamp; }
  }
  const job = (type, completedAt, status = 'DELIVERED') => ({ type, deliveredAt: new Date(completedAt), status });
  const close = rider('closer'), farther = rider('farther');
  close.riderPresence.locationAt = new Clock();
  farther.riderPresence.locationAt = new Clock();
  farther.riderPresence.lng += .02;
  close.history = [job('DELIVERY', '2026-11-22T16:00:00Z')];
  farther.history = [
   job('DELIVERY', '2026-11-22T15:59:59.999Z'),
   job('RIDE', '2026-11-23T08:00:00Z'),
   job('DELIVERY', '2026-11-23T09:00:00Z', 'CANCELLED'),
  ];
  const h = harness({ status: 'PENDING', phase: 'SEARCHING', attempts: 0, riders: [close, farther], type, clock: Clock });
  await h.run();
  return h;
 }
 const delivery = await offer('DELIVERY', '2026-11-23T15:59:59.999Z');
 assert.equal(delivery.booking.riderId, 'farther');
 const [filter] = delivery.completionFilters;
 assert.equal(filter.type, 'DELIVERY');
 assert.equal(filter.deliveredAt.gte.toISOString(), '2026-11-22T16:00:00.000Z');
 assert.equal(filter.deliveredAt.lt.toISOString(), '2026-11-23T16:00:00.000Z');
 assert.match(delivery.dispatch.lastReason, /completed deliveries today/);

 const afterMidnight = await offer('DELIVERY', '2026-11-23T16:00:00Z');
 assert.equal(afterMidnight.booking.riderId, 'closer');
 assert.equal(afterMidnight.completionFilters[0].deliveredAt.gte.toISOString(), '2026-11-23T16:00:00.000Z');

 const ride = await offer('RIDE', '2026-11-23T15:59:59.999Z');
 assert.equal(ride.booking.riderId, 'closer');
 assert.equal(ride.completionFilters[0].status, 'DELIVERED');
 assert.equal(ride.completionFilters[0].type, undefined);
 assert.equal(ride.completionFilters[0].deliveredAt, undefined);
});
test('late open-request pushes are suppressed for excluded riders but allowed for new riders', async () => {
 const booking = { status: 'PENDING', riderId: null, excludedRiderIds: ['missed', 'declined'], paymentMethod: 'CASH', dispatch: { phase: 'OPEN' } }; let eligibilityReads = 0;
 const api = load('src/lib/rider-push-tasks.ts', { './matching-policy': policy, 'node:crypto': require('node:crypto'), './rider-eligibility': { liveApprovalWhere: () => ({}), approvalCoversRoute: () => true }, './job-expiry': { requestHasExpired: () => false } });
 const db = { booking: { findUnique: async () => booking }, user: { findFirst: async () => { eligibilityReads++; return { riderApprovals: [{}] }; } } };
 for (const id of ['missed', 'declined']) assert.equal(await api.riderPushStillRelevant(db, { sourceId: 'rider:new:open', bookingId: 'booking', customerId: id, createdAt: new Date() }), false);
 assert.equal(eligibilityReads, 0); assert.equal(await api.riderPushStillRelevant(db, { sourceId: 'rider:new:open', bookingId: 'booking', customerId: 'next', createdAt: new Date() }), true);
});
