const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const filename = path.resolve(root, file), exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, Date, console: { error() {} }, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', mocks);
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'), mocks);
    return require(name);
  } });
  return exports;
}
const policy = load('src/lib/rider-application-policy.ts');
const guide = load('src/lib/rider-registration.ts');
const fields = { legalName: 'Test Rider', birthDate: '1990-01-01', address: 'Test address', mobile: '09171234567', emergencyName: 'Test Contact', emergencyRelationship: 'Sibling', emergencyPhone: '09181234567', licenceNumber: 'TEST-LIC', licenceCodes: 'A,A1,B', licenceExpiry: '2030-01-01', nbiExpiry: '2030-01-01', vehicleMake: 'Test', vehicleModel: 'Test', vehicleYear: '2024', plateNumber: 'TEST', registrationExpiry: '2030-01-01', capacity: '2', displacement: '125', ownership: 'OWNER', operatingArea: 'Test area', permitNumber: 'TEST-PERMIT' };
function app(patch = {}) { return { status: 'DRAFT', emailVerifiedAt: '2026-10-24', vehicleClass: 'TRICYCLE', services: ['RIDE'], fields: { ...fields }, fieldReviews: {}, documents: policy.requiredDocuments('TRICYCLE', ['RIDE'], fields).map(kind => ({ id: kind, kind, current: true, status: 'PENDING' })), ...patch }; }
test('resume uses saved server progress, gates unverified accounts and routes corrections to their checklist', () => {
  assert.equal(guide.resumeRegistration(app({ fields: { registrationStep: 'documents' } })), 3);
  assert.equal(guide.resumeRegistration(app({ emailVerifiedAt: null, fields: { registrationStep: 'review' } })), 0);
  assert.equal(guide.resumeRegistration(app({ fields: { legalName: 'Existing applicant' } })), 1);
  assert.equal(guide.resumeRegistration(app({ status: 'NEEDS_CORRECTION', fieldReviews: { vehicle: { status: 'NEEDS_CORRECTION' } } })), 2);
  assert.equal(guide.resumeRegistration(app({ status: 'NEEDS_CORRECTION', documents: [{ current: true, status: 'NEEDS_CORRECTION' }] })), 3);
  assert.equal(guide.resumeRegistration(app({ status: 'SUBMITTED', emailVerifiedAt: null })), 4);
});
test('review detects real missing and invalid details and adapts documents for vehicle and ownership', () => {
  const current = app(), now = new Date('2026-10-24T12:00:00Z');
  assert.equal(guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], fields, now).length, 0);
  const missing = guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], { ...fields, mobile: '', ownership: 'BORROWED' }, now);
  assert(missing.some(i => i.step === 2 && i.message.includes('Mobile')));
  assert(missing.some(i => i.step === 3 && i.message.includes('authorization')));
  assert(guide.registrationIssues(current, 'TRICYCLE', [], fields, now).some(i => i.step === 1));
  assert(guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], { ...fields, licenceExpiry: '2020-01-01' }, now).some(i => i.step === 2));
  assert.equal(guide.visibleFields(['displacement', 'permitNumber'], 'SEDAN', ['DELIVERY']).length, 0);
});
test('a flagged detail clears its local reminder only when edited; accepted docs remain uploaded', () => {
  const current = app({ status: 'NEEDS_CORRECTION', fieldReviews: { vehicle: { status: 'NEEDS_CORRECTION', reason: 'Correct the plate' } } });
  assert(guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], fields).some(i => i.message.includes('Correct the plate')));
  assert(!guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], { ...fields, plateNumber: 'CORRECTED' }).some(i => i.message.includes('Correct the plate')));
  current.documents[0].status = 'NEEDS_CORRECTION';
  assert(guide.registrationIssues(current, 'TRICYCLE', ['RIDE'], fields).some(i => i.step === 3));
});
test('resume metadata is allowlisted and cannot mark an incomplete application ready', () => {
  assert.equal(policy.normalizeFields({ registrationStep: 'review' }).registrationStep, 'review');
  assert.throws(() => policy.normalizeFields({ registrationStep: 'ACTIVE' }));
  const incomplete = app({ fields: { registrationStep: 'review' }, emailVerifiedAt: null, documents: [] });
  assert(guide.registrationIssues(incomplete, 'TRICYCLE', ['RIDE'], incomplete.fields).length > 10);
  assert.throws(() => policy.validateApplication('TRICYCLE', ['RIDE'], incomplete.fields));
});
test('account-only signup creates an unapproved draft; older vehicle payloads and duplicate detection still work', async () => {
  const creations = [];
  let exists = false;
  class RateLimitError extends Error {}
  const { POST } = load('src/app/api/auth/signup/route.ts', {
    '@/lib/db': { db: { user: { findUnique: async () => exists ? { id: 'existing' } : null, create: async input => { creations.push(input.data); return { id: 'test', ...input.data }; } } } },
    '@/lib/request-guard': { withRequestLog: (_name, fn) => fn, RateLimitError, limitRequests: async () => {}, clientAddress: () => 'fixture', safeErrorCode: () => 'test' },
    '@/lib/password': { hashPassword: () => 'TEST_HASH' }, '@/lib/session': { createSessionToken: () => 'TEST_SESSION', setSessionCookie: async () => {} },
    '@/lib/db-data': { publicUser: user => ({ id: user.id, role: user.role }) },
  });
  const input = { name: 'Test Rider', email: 'rider@example.invalid', password: 'Testing12345!', role: 'RIDER' };
  async function post(patch = {}) { return POST(new Request('http://fixture.invalid/api/auth/signup', { method: 'POST', body: JSON.stringify({ ...input, ...patch }) })); }
  assert.equal((await post()).status, 200);
  assert.equal(creations[0].riderApplication.create.fields.registrationStep, 'vehicle');
  assert.equal(creations[0].riderProfile.create.vehicleClass, 'MOTORCYCLE');
  assert(!Object.hasOwn(creations[0], 'riderApprovals'));
  assert.equal((await post({ vehicleClass: 'TRICYCLE' })).status, 200);
  assert.equal(creations[1].riderProfile.create.vehicleClass, 'TRICYCLE');
  assert.equal((await post({ vehicleClass: 'CLOSED_VAN' })).status, 400);
  exists = true;
  assert.equal((await post()).status, 409);
  assert.equal(creations.length, 2);
});
