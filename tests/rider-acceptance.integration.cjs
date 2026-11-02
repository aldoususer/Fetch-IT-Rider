// Explicit isolated schema + localhost only. No real email, push or bookings.
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const [envFile, riderBase = 'http://127.0.0.1:3083', customerBase = 'http://localhost:3082'] = process.argv.slice(2);
if (!envFile) throw Error('Pass the isolated environment JSON path.');
const env = JSON.parse(fs.readFileSync(envFile, 'utf8')), url = new URL(env.DATABASE_URL);
assert(/^fetch_rider_lab_[a-f0-9]{32}$/.test(url.searchParams.get('schema')));
assert.equal(env.LOCAL_DISABLE_PUSH_TRANSPORT, '1'); assert.equal(env.GMAIL_APP_PASSWORD, '');
for (const base of [riderBase, customerBase]) assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const db = new PrismaClient({ datasourceUrl: url.toString() }), passes = [], bookings = [], timing = {};
const pass = message => { passes.push(message); console.log('PASS ' + message); };
function actor(base) {
  const jar = new Map();
  return async (route, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + route, { method, headers: { cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(40000) });
    for (const header of response.headers.getSetCookie()) { const [key, ...value] = header.split(';')[0].split('='); jar.set(key, value.join('=')); }
    return { status: response.status, data: await response.json() };
  };
}
function ok(response) { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data; }
const fix = (age = 0) => ({ lat: 16.0206, lng: 120.2321, accuracy: 10, capturedAt: Date.now() - age });
async function main() {
  const tag = crypto.randomBytes(5).toString('hex'), password = 'LocalAcceptance-Only-2026!', salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
  async function user(role, suffix) {
    const email = `acceptance-${tag}-${suffix}@matching.fetchit.invalid`;
    const row = await db.user.create({ data: { email, name: 'Isolated Acceptance ' + suffix, role, authIdentities: { create: { provider: 'PASSWORD', providerUserId: email, passwordHash } }, ...(role === 'RIDER' ? { riderProfile: { create: { vehicleClass: 'SEDAN', vehiclePlate: 'LOCAL-' + suffix } }, riderPresence: { create: { isOnline: false } }, riderApprovals: { create: [{ vehicleClass: 'SEDAN', service: 'RIDE', source: 'OWNER_PERSONA' }] } } : {}) } });
    const http = actor(role === 'RIDER' ? riderBase : customerBase); ok(await http('/api/auth/login', { email, password, role })); return { row, http };
  }
  const customer = await user('CUSTOMER', 'customer'), a = await user('RIDER', 'a'), b = await user('RIDER', 'b');
  async function booking(riderId = null, extra = {}) {
    const row = await db.booking.create({ data: { refCode: 'LOCAL-ACCEPT-' + crypto.randomBytes(5).toString('hex'), customerId: customer.row.id, riderId, type: 'RIDE', status: riderId ? 'MATCHED' : 'PENDING', vehicleClass: 'SEDAN', pickupLabel: 'Isolated test · Lingayen', pickupLat: 16.0206, pickupLng: 120.2321, dropoffLabel: 'Isolated test · Dagupan', dropoffLat: 16.0434, dropoffLng: 120.334, baseFare: 100, totalFare: 200, distanceKm: 14, ...(riderId ? { matchedAt: new Date(), assignmentExpiresAt: new Date(Date.now() + 120000) } : {}), ...extra } }); bookings.push(row.id); return row;
  }
  const request = (rider, job, location) => rider.http('/api/bookings/' + job.id, { status: 'ACCEPTED', ...(location ? { location } : {}) }, 'PATCH');
  async function cancel(job) { ok(await customer.http('/api/bookings/' + job.id + '/cancel', { reason: 'Isolated acceptance verification complete.' })); }
  for (const rider of [a, b]) {
    const p256dh = crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth = crypto.randomBytes(16).toString('base64url');
    ok(await rider.http('/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/local-acceptance-' + crypto.randomUUID(), keys: { p256dh, auth } }));
  }
  const offline = await booking(); assert.equal((await request(a, offline, fix())).status, 409);
  assert.equal((await db.riderPresence.findUnique({ where: { userId: a.row.id } })).isOnline, false); await cancel(offline); pass('combined request cannot put an offline rider online');
  for (const rider of [a, b]) ok(await rider.http('/api/rider/status', { online: true, notificationPermission: 'granted', location: fix() }));

  const legacy = await booking(a.row.id); await db.riderPresence.update({ where: { userId: a.row.id }, data: { locationAt: new Date(Date.now() - 60000) } });
  let start = performance.now(); ok(await a.http('/api/rider/location', fix())); ok(await request(a, legacy)); timing.legacyTwoRequestsMs = Math.round(performance.now() - start); await cancel(legacy);
  const combined = await booking(a.row.id); await db.riderPresence.update({ where: { userId: a.row.id }, data: { locationAt: new Date(Date.now() - 60000) } });
  start = performance.now(); const location = fix(); const result = ok(await request(a, combined, location)); timing.combinedOneRequestMs = Math.round(performance.now() - start);
  assert.equal(result.booking.status, 'ACCEPTED'); assert.equal((await db.riderPresence.findUnique({ where: { userId: a.row.id } })).locationAt.getTime(), location.capturedAt);
  assert.equal(ok(await customer.http('/api/bookings/status?onlyTracked=1&ids=' + combined.id)).bookings[0].status, 'ACCEPTED'); pass('one request saves fresh GPS and acceptance together; Customer observes accepted');
  ok(await request(a, combined, fix())); assert.equal(await db.bookingEvent.count({ where: { bookingId: combined.id, toStatus: 'ACCEPTED' } }), 1); pass('retry after success remains idempotent');

  const conflict = await booking(); const before = await db.riderPresence.findUnique({ where: { userId: a.row.id } });
  assert.equal((await request(a, conflict, { ...fix(), lat: 16.03 })).status, 409);
  const after = await db.riderPresence.findUnique({ where: { userId: a.row.id } }); assert.equal(after.lat, before.lat); assert.equal(after.locationAt.getTime(), before.locationAt.getTime());
  assert.equal((await db.booking.findUnique({ where: { id: conflict.id } })).status, 'PENDING'); await cancel(conflict); pass('conflicting active work rolls back the submitted GPS and booking together');
  await cancel(combined);

  const invalid = await booking(a.row.id);
  for (const value of [fix(31000), { ...fix(), accuracy: 101 }, { ...fix(), lat: 999 }]) assert.equal((await request(a, invalid, value)).status, 400);
  assert.equal((await db.booking.findUnique({ where: { id: invalid.id } })).status, 'MATCHED'); await cancel(invalid); pass('stale, inaccurate and invalid coordinates cannot accept a booking');

  const competition = await booking(); const competing = await Promise.all([request(a, competition, fix()), request(b, competition, fix())]);
  assert.equal(competing.filter(r => r.status === 200).length, 1); assert.equal(competing.filter(r => r.status === 409).length, 1);
  assert.equal(await db.bookingEvent.count({ where: { bookingId: competition.id, toStatus: 'ACCEPTED' } }), 1); await cancel(competition); pass('two concurrent riders produce exactly one accepted booking');
  for (const rider of [a, b]) ok(await rider.http('/api/rider/status', { online: false }));
  console.log(JSON.stringify({ passed: passes.length, timing, note: 'Local HTTP to isolated database, excludes device GPS; not a phone latency guarantee.' }));
  if (process.env.ACCEPTANCE_RESULT_FILE) fs.writeFileSync(process.env.ACCEPTANCE_RESULT_FILE, JSON.stringify({ passed: passes.length, passes, timing, bookings }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
