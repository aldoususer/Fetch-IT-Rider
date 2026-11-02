const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  imports = { "./booking-client-timing": { startBookingTiming: () => ({ headers: {}, response() {}, finish() {} }) }, "./booking-mutation-client": { savedMutation: async () => null }, ...imports };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Error, Response, AbortSignal, console, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; }, ...globals });
  return exports;
}
const fix = (age = 0, extra = {}) => ({ lat: 16.0206, lng: 120.2321, accuracy: 10, capturedAt: Date.now() - age, ...extra });
function client() {
  let permission = 'granted', captures = 0, options, point = fix();
  const navigator = { permissions: { query: async () => ({ state: permission }) }, geolocation: { getCurrentPosition(success, failure, settings) { captures++; options = settings; success({ coords: { latitude: point.lat, longitude: point.lng, accuracy: point.accuracy }, timestamp: point.capturedAt }); } } };
  const api = load('src/lib/rider-location-client.ts', {}, { window: { isSecureContext: true }, navigator });
  return { api, navigator, setPermission(value) { permission = value; }, setPoint(value) { point = value; }, get captures() { return captures; }, get options() { return options; } };
}
test('fresh accurate account-scoped fixes avoid another GPS acquisition', async () => {
  const h = client(), saved = fix(5000); h.api.rememberRiderLocation('rider-a', saved);
  assert.equal((await h.api.acceptanceLocation('rider-a')).capturedAt, saved.capturedAt); assert.equal(h.captures, 0);
  await h.api.acceptanceLocation('rider-b'); assert.equal(h.captures, 1); assert.equal(h.options.maximumAge, 15000);
});
test('stale, inaccurate and cleared fixes require device acquisition', async () => {
  for (const value of [fix(16000), fix(0, { accuracy: 101 }), fix(0, { lat: 999 })]) {
    const h = client(); h.api.rememberRiderLocation('r', value); await h.api.acceptanceLocation('r'); assert.equal(h.captures, 1);
  }
  const h = client(); h.api.rememberRiderLocation('r', fix()); h.api.clearRiderLocation('r'); await h.api.acceptanceLocation('r'); assert.equal(h.captures, 1);
});
test('revoked permission clears the cache; unsupported permission queries use the browser permission check', async () => {
  const h = client(); h.api.rememberRiderLocation('r', fix()); h.setPermission('denied'); await assert.rejects(h.api.acceptanceLocation('r'), /blocked/); assert.equal(h.captures, 0);
  h.setPermission('granted'); await h.api.acceptanceLocation('r'); assert.equal(h.captures, 1);
  h.navigator.permissions.query = async () => { throw Error('Unsupported'); }; await h.api.acceptanceLocation('r'); assert.equal(h.captures, 2);
});
test('acceptance performs one PATCH containing the fix, with no separate location upload', async () => {
  const h = client(); h.api.rememberRiderLocation('r', fix(1000)); const requests = [], phases = [];
  const api = load('src/lib/rider-acceptance-client.ts', { './rider-location-client': h.api }, {
    window: { Notification: {} }, Notification: { permission: 'granted' }, fetch: async (url, init) => { requests.push({ url, ...init }); return Response.json({ booking: { id: 'job', riderId: 'r', status: 'ACCEPTED' } }); },
  });
  assert.equal((await api.acceptRiderBooking('job', 'r', phase => phases.push(phase))).status, 'ACCEPTED');
  assert.equal(h.captures, 0); assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/bookings/job'); assert.equal(requests[0].method, 'PATCH');
  const body = JSON.parse(requests[0].body); assert.equal(body.status, 'ACCEPTED'); assert.equal(body.location.accuracy, 10); assert.deepEqual(phases, ['location', 'accepting']);
});
test('ambiguous acceptance never retries automatically or reports success', async () => {
  let requests = 0;
  const api = load('src/lib/rider-acceptance-client.ts', { './rider-location-client': { acceptanceLocation: async () => fix() } }, { window: { Notification: {} }, Notification: { permission: 'granted' }, fetch: async () => { requests++; throw Error('Network timeout'); } });
  await assert.rejects(api.acceptRiderBooking('job', 'r'), /check Active/); assert.equal(requests, 1);
});
test('notification refusal prevents location acquisition and acceptance', async () => {
  let captures = 0;
  const api = load('src/lib/rider-acceptance-client.ts', { './rider-location-client': { acceptanceLocation: async () => { captures++; return fix(); } } }, { window: { Notification: {} }, Notification: { permission: 'denied' } });
  await assert.rejects(api.acceptRiderBooking('job', 'r'), /notifications/); assert.equal(captures, 0);
});

const roads = load('src/lib/road-routing.ts'), policy = load('src/lib/matching-policy.ts', { './road-routing': roads });
function reservation({ online = true, subscription = true, approved = true, vehicle = 'SEDAN', active = 0, newer = false, phase = null } = {}) {
  let presence = { isOnline: online, lat: 16, lng: 120, locationAt: new Date(Date.now() - (newer ? 0 : 60000)), locationAccuracy: 10, updatedAt: new Date() }, writes = 0; const sequence = [];
  const tx = { $queryRaw: async () => sequence.push('user lock'), autoDispatch: { findUnique: async () => phase ? { phase } : null },
    riderPresence: { updateMany: async ({ where, data }) => { assert.equal(sequence[0], 'user lock'); assert.equal(where.userId, 'r'); assert.equal(where.isOnline, true); if (presence.isOnline && data.locationAt >= presence.locationAt) { presence = { ...presence, ...data, updatedAt: new Date() }; writes++; } } },
    user: { findUnique: async () => ({ role: 'RIDER', isBanned: false, riderProfile: { vehicleClass: vehicle }, riderPresence: presence }) },
    customerPushSubscription: { findFirst: async ({ where }) => { assert.equal(where.deviceId, 'current-device'); return subscription ? { id: 'sub' } : null; } }, booking: { count: async () => active },
  };
  const api = load('src/lib/dispatch.ts', { './matching-policy': policy, './job-expiry': { requestHasExpired: () => false }, './demo-payments': {}, './rider-eligibility': { riderCanTakeBooking: async () => approved }, './payment-policy': { isDemoPayment: () => false }, './booking-events': {}, './push-delivery': {}, './platform-policy': {} });
  return { run: value => api.reserveAvailableRider(tx, 'r', { id: 'b', status: 'PENDING', vehicleClass: 'SEDAN', paymentMethod: 'CASH' }, new Date(), false, { deviceId: 'current-device', location: value }), get presence() { return presence; }, get writes() { return writes; } };
}
test('acceptance location is checked under the rider lock and cannot replace a newer fix', async () => {
  const location = policy.onlineLocationInput(fix(2000)); const h = reservation(); await h.run(location); assert.equal(h.writes, 1); assert.equal(h.presence.locationAt.getTime(), location.locationAt.getTime());
  const newer = reservation({ newer: true }), captured = newer.presence.locationAt.getTime(); await newer.run(location); assert.equal(newer.writes, 0); assert.equal(newer.presence.locationAt.getTime(), captured);
  await assert.rejects(reservation().run({ ...location, locationAt: new Date(0) }), /fresh/);
});
test('combined acceptance retains online, device subscription, approval, vehicle and active-job gates', async () => {
  for (const options of [{ online: false }, { subscription: false }, { approved: false }, { vehicle: 'MOTORCYCLE' }, { active: 1 }]) await assert.rejects(reservation(options).run(policy.onlineLocationInput(fix())));
});
test('combined acceptance still rejects open-list claims while dispatch is searching or offering', async () => {
  for (const phase of ['SEARCHING', 'OFFERED', 'DONE']) await assert.rejects(reservation({ phase }).run(policy.onlineLocationInput(fix())), /offered/);
  await reservation({ phase: 'OPEN' }).run(policy.onlineLocationInput(fix()));
});
