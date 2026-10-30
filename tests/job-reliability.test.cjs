const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, deps = {}, globals = {}) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Set, Object, Number, Error, AbortController, require(name) { if (!(name in deps)) throw Error('Unexpected import ' + name); return deps[name]; }, ...globals }); return exports; }
const expiry = load('src/lib/job-expiry.ts'), alerts = load('src/lib/rider-alerts.ts');
const now = new Date('2026-10-30T04:00:00Z');
const request = extra => ({ id: 'booking', customerId: 'customer', riderId: null, type: 'RIDE', status: 'PENDING', createdAt: new Date(now - 600000), scheduledAt: null, paymentMethod: 'CASH', paymentStatus: 'UNPAID', ...extra });
test('ride expires at ten minutes; delivery gets thirty minutes', () => {
 assert.equal(expiry.requestHasExpired(request(), now), true);
 assert.equal(expiry.requestHasExpired(request({ createdAt: new Date(now - 599999) }), now), false);
 assert.equal(expiry.requestHasExpired(request({ type: 'DELIVERY' }), now), false);
 assert.equal(expiry.requestHasExpired(request({ type: 'DELIVERY', createdAt: new Date(now - 1800000) }), now), true);
});
test('scheduled acceptance window starts at pickup, never creation or reassignment', () => {
 assert.equal(expiry.requestHasExpired(request({ createdAt: new Date(now - 86400000), scheduledAt: new Date(now.getTime() + 1) }), now), false);
 assert.equal(expiry.requestHasExpired(request({ createdAt: new Date(now - 86400000), scheduledAt: new Date(now - 600000), status: 'MATCHED' }), now), true);
});
test('accepted work, finished bookings and recorded cash never auto-expire', () => {
 for (const status of ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) assert.equal(expiry.requestHasExpired(request({ status }), now), false, status);
 for (const patch of [{ customerPaidAt: now }, { riderReceivedAt: now }, { paymentStatus: 'PAID' }, { pickedUpAt: now }]) assert.equal(expiry.requestHasExpired(request(patch), now), false);
});
function dispatchHarness(current, { locked = true, payment = false } = {}) {
 const events = [], changes = [], refunds = [];
 const tx = { $queryRaw: async () => locked ? [{ id: 'booking' }] : [], booking: { findUnique: async () => current, update: async query => { changes.push(query.data); return current; } }, bookingLocation: { deleteMany: async () => {} }, deliveryChallenge: { deleteMany: async () => {} } };
 const db = { booking: { findMany: async () => [{ id: 'booking' }] }, $transaction: fn => fn(tx) };
 const module = load('src/lib/dispatch.ts', { './job-expiry': expiry, './demo-payments': { cancelDemoPayment: async (...args) => refunds.push(args) }, './rider-eligibility': { riderCanTakeBooking: async () => true }, './payment-policy': { isDemoPayment: () => payment }, './booking-events': { recordBookingEvent: async (...args) => events.push(args) }, './push-delivery': { schedulePushDelivery() {} }, './platform-policy': {} });
 return { run: () => module.expireUnansweredRequests(db, now), changes, events, refunds };
}
test('expiry rechecks the locked row after a competing acceptance', async () => { const h = dispatchHarness(request({ status: 'ACCEPTED' })); assert.equal(await h.run(), 0); assert.equal(h.changes.length, 0); });
test('concurrent expiry skips already-held rows rather than double notifying', async () => { const h = dispatchHarness(request(), { locked: false }); assert.equal(await h.run(), 0); assert.equal(h.events.length, 0); });
test('expiry commits cancellation, payment cleanup and explanatory event together', async () => { const h = dispatchHarness(request({ paymentMethod: 'DEMO_GCASH', paymentStatus: 'PAID' })); assert.equal(await h.run(), 1); assert.equal(h.changes[0].status, 'CANCELLED'); assert.match(h.changes[0].cancellationReason, /Request expired/); assert.equal(h.refunds.length, 1); assert.equal(h.refunds[0][2].uid, 'system:request-expiry'); assert.equal(h.events[0][3].action, 'CANCELLED'); });
const job = extra => ({ id: 'job', refCode: 'FIT-ONE', type: 'DELIVERY', status: 'PENDING', createdAt: '2026-10-30T04:00:00Z', updatedAt: '2026-10-30T04:00:00Z', scheduledAt: null, ...extra });
const snapshot = (at, available = [], assigned = []) => ({ checkedAt: at, available, assigned });
test('first notification baseline never replays existing jobs or historical cancellations', () => { const result = alerts.advanceRiderAlerts(null, snapshot(now.toISOString(), [job()], [job({ status: 'CANCELLED' })])); assert.equal(result.added.length, 0); });
test('new eligible request notifies exactly once and a disappearing request is not called cancelled', () => {
 const base = alerts.advanceRiderAlerts(null, snapshot(now.toISOString())).state;
 const next = snapshot('2026-10-30T04:01:00Z', [job({ createdAt: '2026-10-30T04:00:30Z' })]);
 const a = alerts.advanceRiderAlerts(base, next); assert.equal(a.added.length, 1);
 assert.equal(alerts.advanceRiderAlerts(a.state, next).added.length, 0);
 assert.equal(alerts.advanceRiderAlerts(a.state, snapshot('2026-10-30T04:02:00Z')).added.length, 0);
});
test('customer cancellation is caught across tabs and after reconnect without replay', () => {
 const base = alerts.advanceRiderAlerts(null, snapshot(now.toISOString(), [], [job({ status: 'ACCEPTED' })])).state;
 const next = snapshot('2026-10-30T04:02:00Z', [], [job({ status: 'CANCELLED', updatedAt: '2026-10-30T04:01:00Z' })]);
 const result = alerts.advanceRiderAlerts(base, next); assert.equal(result.added[0].title, 'Booking cancelled'); assert.equal(result.added[0].history, true);
 assert.equal(alerts.advanceRiderAlerts(result.state, next).added.length, 0);
});
test('scheduled request sends one reminder and one due alert', () => {
 const scheduled = job({ scheduledAt: '2026-10-30T04:20:00Z' });
 let state = alerts.advanceRiderAlerts(null, snapshot(now.toISOString(), [scheduled])).state;
 let result = alerts.advanceRiderAlerts(state, snapshot('2026-10-30T04:10:00Z', [scheduled])); assert.equal(result.added[0].title, 'Scheduled pickup soon'); state = result.state;
 result = alerts.advanceRiderAlerts(state, snapshot('2026-10-30T04:15:00Z', [scheduled])); assert.equal(result.added.length, 0); state = result.state;
 result = alerts.advanceRiderAlerts(state, snapshot('2026-10-30T04:20:00Z', [scheduled])); assert.equal(result.added[0].title, 'Scheduled request is available');
});
test('old jobs becoming visible on go-online do not create a historical flood', () => {
 const state = alerts.advanceRiderAlerts(null, snapshot(now.toISOString())).state;
 assert.equal(alerts.advanceRiderAlerts(state, snapshot('2026-10-30T04:01:00Z', [job({ createdAt: '2026-10-20T00:00:00Z' })])).added.length, 0);
});
test('a stale cross-tab response cannot undo newer inbox state', () => {
 const state = alerts.advanceRiderAlerts(null, snapshot(now.toISOString())).state;
 assert.equal(alerts.advanceRiderAlerts(state, snapshot('2026-10-29T04:00:00Z', [job()])).state, state);
 assert.equal(alerts.readRiderAlertState({ ...state, items: [{ title: {} }] }), null);
 assert(alerts.readRiderAlertState(state));
});
test('poll timeouts surface reconnecting, preserve state and resume immediately on connection', async () => {
 const slots = [], effects = [], handlers = {}, deadlines = [], intervals = []; let index = 0, rejectPoll, calls = 0;
 const react = { useRef(value) { const i = index++; return slots[i] ??= { current: value }; }, useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useEffect(fn) { index++; effects.push(fn); } };
 const navigator = { onLine: true };
 const module = load('src/hooks/use-visible-poll.ts', { react }, { navigator, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, window: { addEventListener(name, fn) { handlers[name] = fn; }, removeEventListener() {} }, setInterval(fn) { intervals.push(fn); return 1; }, clearInterval() {}, setTimeout(fn) { deadlines.push(fn); return 1; }, clearTimeout() {} });
 const poll = async signal => { calls++; if (calls === 1) return new Promise((_, reject) => { rejectPoll = reject; signal.addEventListener('abort', () => reject(Error('timeout'))); }); };
 module.useVisiblePoll('rider:jobs', poll); effects.forEach(fn => fn());
 deadlines[0](); await new Promise(resolve => setImmediate(resolve)); assert.equal(slots[1].status, 'reconnecting');
 handlers.online(); await new Promise(resolve => setImmediate(resolve)); assert.equal(slots[1].status, 'connected'); assert.equal(calls, 2);
 navigator.onLine = false; handlers.offline(); assert.equal(slots[1].status, 'offline'); assert(slots[1].lastSuccessAt);
});
