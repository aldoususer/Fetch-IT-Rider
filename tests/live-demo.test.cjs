const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { PDFDocument } = require('pdf-lib');
const { loader } = require('./helpers/load-local-demo.cjs');

test('live demo endpoint requires own verified demo account, matching version and same origin; never verifies codes', async () => {
  let session = null, normalCalls = 0;
  const application = { isDemo: true, version: 2, status: 'DRAFT', user: { email: 'tester@example.invalid', isBanned: false }, emailVerifiedAt: new Date(), verifiedEmail: 'tester@example.invalid' };
  class RateLimitError extends Error {}
  const load = loader({ NODE_ENV: 'production' }, {
    '@/lib/db': { db: { riderApplication: { findUnique: async () => application } } },
    '@/lib/session': { getSession: async () => session },
    '@/lib/application-applicant-api': { applicantRequest: async () => { normalCalls++; throw Error('Must not reach normal API'); } },
    '@/lib/request-guard': { withRequestLog: (_s, handler) => handler, limitRequests: async () => {} },
    './request-guard': { RateLimitError },
  });
  const { POST } = load('src/app/api/rider/application/demo/route.ts');
  const call = (body = {}, origin = 'https://rider.example.invalid') => POST(new NextRequest('https://rider.example.invalid/api/rider/application/demo', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'documents', version: 2, ...body }) }));
  assert.equal((await call()).status, 401);
  session = { uid: 'own-rider', role: 'CUSTOMER' }; assert.equal((await call()).status, 401);
  session.role = 'RIDER'; application.isDemo = false; assert.equal((await call()).status, 403);
  application.isDemo = true; application.verifiedEmail = 'another@example.invalid'; assert.equal((await call()).status, 403);
  application.verifiedEmail = application.user.email; assert.equal((await call({}, 'https://other.invalid')).status, 403);
  assert.equal((await call({ version: 1 })).status, 409);
  assert.equal((await call({ action: 'verify' })).status, 400);
  application.status = 'SUBMITTED'; assert.equal((await call()).status, 409);
  assert.equal(normalCalls, 0);
});

test('production sample assets and all document types remain visibly identified as demos', async () => {
  const load = loader({ NODE_ENV: 'production' }), data = load('src/lib/rider-demo-data.ts');
  const portrait = await data.demoPortrait(); assert(portrait.length > 1000 && portrait.length < 3 * 1024 * 1024);
  assert((await data.demoPortrait('one-application')).equals(await data.demoPortrait('one-application')));
  const fields = data.demoFields('TRICYCLE', 'Demo Test Rider');
  const { DOCUMENT_LABELS } = load('src/lib/rider-application-policy.ts');
  for (const kind of Object.keys(DOCUMENT_LABELS).filter(k => k !== 'PROFILE')) {
    const bytes = await data.demoDocument(kind, fields, 'TRICYCLE', portrait), pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1); assert.match(pdf.getTitle(), /^DEMO \/ NOT VALID/); assert(bytes.length < 3 * 1024 * 1024);
  }
});

test('demo completion emails are explicit and the server blocks real activation', () => {
  const load = loader({ NODE_ENV: 'production' }), { applicationMessage } = load('src/lib/application-mail.ts');
  const payload = { name: 'Demo Test Rider', applicationId: 'fixture', vehicle: 'TRICYCLE', services: 'DELIVERY / RIDE', demo: true };
  const complete = applicationMessage('ACTIVATED', payload);
  assert(complete.subject.startsWith('[DEMO]')); assert(!complete.text.includes('are activated')); assert(complete.text.includes('No real rider services'));
  assert(applicationMessage('CORRECTIONS', { ...payload, corrections: ['Replace only OR'] }).text.includes('Replace only OR'));
  assert(!applicationMessage('CORRECTIONS', { ...payload, demo: false }).subject.startsWith('[DEMO]'));
  const { assertRealApplication } = load('src/lib/application-demo-policy.ts');
  assert.throws(() => assertRealApplication({ isDemo: true }), e => e.status === 403);
  assertRealApplication({ isDemo: false });
});
