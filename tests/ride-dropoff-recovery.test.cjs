const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}, Clock = Date) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in imports)) throw Error(name);
    return imports[name];
  }, Date: Clock });
  return exports;
}

test('drop-off report preserves trip status, prompts once, and releases the rider at three minutes', async () => {
  const reportedAt = new Date('2026-11-21T05:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [reportedAt])); }
    static now() { return reportedAt.getTime(); }
  }
  let booking = { id: 'ride', status: 'IN_TRANSIT', type: 'RIDE', riderId: 'rider', customerId: 'customer', refCode: 'RIDE-1',
    customerPickupConfirmedAt: reportedAt, pickedUpAt: reportedAt, riderDropoffReportedAt: null, customerDropoffConfirmedAt: null };
  const notifications = [];
  let events = 0;
  const tx = {
    $queryRaw: async () => [],
    booking: { findUnique: async () => booking, update: async ({ data }) => (booking = { ...booking, ...data, updatedAt: reportedAt }) },
    customerNotification: { create: async ({ data }) => notifications.push(data) },
  };
  class RiderError extends Error { constructor(message, status) { super(message); this.status = status; } }
  let riderId = 'other';
  const api = load('src/app/api/bookings/[id]/dropoff-report/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/db': { db: { $transaction: work => work(tx) } },
    '@/lib/rider-access': { RiderError, getRiderSession: async () => ({ uid: riderId, role: 'RIDER' }), riderErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 503 }) },
    '@/lib/request-guard': { limitRequests: async () => {}, RateLimitError: class extends Error {}, withRequestLog: (_, handler) => handler },
    '@/lib/booking-events': { recordBookingEvent: async () => ({ id: String(++events) }) },
    '@/lib/push-delivery': { schedulePushDelivery: () => {} },
  }, Clock);
  const report = () => api.POST({ headers: new Headers() }, { params: Promise.resolve({ id: 'ride' }) });
  assert.equal((await report()).status, 404);
  riderId = 'rider';
  assert.equal((await report()).status, 200);
  assert.equal((await report()).status, 200);
  assert.equal(booking.status, 'IN_TRANSIT');
  assert.equal(booking.customerDropoffConfirmedAt, null);
  assert.equal(events, 1);
  assert.equal(notifications[0].customerId, 'customer');
  const { riderWorkInProgressWhere } = load('src/lib/rider-occupancy.ts');
  const busy = time => booking.riderDropoffReportedAt > riderWorkInProgressWhere(new Date(time)).OR[1].riderDropoffReportedAt.gt;
  assert.equal(busy(+reportedAt + 179_999), true);
  assert.equal(busy(+reportedAt + 180_000), false);
});

test('capture time wins over arrival order and reporting drop-off freezes trip tracking', async () => {
  let latest = null;
  const booking = { id: 'ride', riderId: 'rider', status: 'IN_TRANSIT', riderDropoffReportedAt: null };
  const tx = {
    $queryRaw: async () => [],
    booking: { findUnique: async () => booking },
    bookingLocation: { findUnique: async () => latest, upsert: async ({ update }) => (latest = update) },
    trackingUpdate: { findFirst: async () => ({ createdAt: new Date() }), create: async () => {} },
  };
  const { locationInput, publishLocation } = load('src/lib/tracking.ts', {
    './db': { db: { $transaction: work => work(tx) } }, './rider-access': { RiderError: Error },
  });
  const now = Date.now();
  const publish = (lat, capturedAt) => publishLocation('R0001', 'rider', locationInput({ lat, lng: 120, capturedAt }));
  await publish(16.1, now - 1000);
  await publish(16, now - 2000);
  await publish(16, undefined);
  assert.equal(latest.lat, 16.1);
  assert.equal(+latest.createdAt, now - 1000);
  booking.riderDropoffReportedAt = new Date(now);
  await publish(16.2, now);
  assert.equal(latest.lat, 16.1);
});

test('offer cleanup skips a booking that crosses its deadline after the initial query', async () => {
  const now = Date.now();
  let time = now;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  const expiry = load('src/lib/job-expiry.ts', {}, Clock);
  const booking = { id: 'ride', type: 'RIDE', status: 'MATCHED', paymentMethod: 'CASH', paymentStatus: 'UNPAID',
    createdAt: new Date(now - expiry.REQUEST_WINDOW_MS.RIDE + 5), assignmentExpiresAt: new Date(now - 100) };
  const dispatch = load('src/lib/dispatch.ts', {
    './job-expiry': expiry, './demo-payments': {}, './rider-eligibility': {}, './payment-policy': {},
    './booking-events': {}, './push-delivery': { schedulePushDelivery() {} }, './platform-policy': {}, './matching-policy': {},
    './rider-cancellation': {}, './rider-cancellation-policy': {}, './rider-occupancy': {},
  }, Clock);
  const db = {
    booking: { findMany: async ({ where }) => where.status === 'MATCHED' ? [{ id: 'ride' }] : [] },
    $transaction: async work => {
      time = now + 10;
      return work({ $queryRaw: async () => [{ id: 'ride' }], booking: { findUnique: async () => booking } });
    },
  };
  assert.equal(await dispatch.expireRiderOffers(db), 0);
});
