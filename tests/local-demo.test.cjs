const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const { loader } = require('./helpers/load-local-demo.cjs');
function environment() {
  const schema = 'fetch_rider_lab_' + randomUUID().replaceAll('-', '');
  const url = new URL('postgresql://fixture:fixture@fixture.invalid/test'); url.searchParams.set('schema', schema); url.searchParams.set('options', `-c search_path=${schema},pg_catalog`);
  return { NODE_ENV: 'development', LOCAL_RIDER_LAB: '1', LOCAL_DEMO_SCHEMA: schema, DATABASE_URL: url.toString(), LOCAL_DEMO_DIRECTORY: path.resolve(__dirname, '../tmp/local-rider-lab', schema) };
}
test('lab guards reject production, Vercel, public schemas, non-loopback hosts and cross-origin writes', async () => {
  const env = environment(), { localDemoEnabled, assertLocalDemo } = loader(env)('src/lib/local-demo-runtime.ts');
  assert(localDemoEnabled());
  for (const patch of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { LOCAL_RIDER_LAB: '0' }, { DATABASE_URL: 'postgresql://fixture:fixture@fixture.invalid/test?schema=public' }, { LOCAL_DEMO_SCHEMA: 'public' }]) assert.equal(localDemoEnabled({ ...env, ...patch }), false);
  await assert.rejects(assertLocalDemo(new Request('https://fetch-it-rider.vercel.app/api/local-demo')));
  await assert.rejects(assertLocalDemo(new Request('http://127.0.0.1:3011/api/local-demo', { method: 'POST', headers: { Origin: 'https://other.invalid' } })));
  await assertLocalDemo(new Request('http://127.0.0.1:3011/api/local-demo', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3011' } }));
  await assertLocalDemo(new Request('http://localhost:3011/api/local-demo', { method: 'POST', headers: { Host: '127.0.0.1:3011', Origin: 'http://127.0.0.1:3011' } }));
  await assert.rejects(assertLocalDemo(new Request('http://localhost:3011/api/local-demo', { method: 'POST', headers: { Host: 'other.invalid:3011', Origin: 'http://other.invalid:3011' } })));
  const wrong = loader(env, { './db': { db: { $queryRaw: async () => [{ schema: 'public' }] } } })('src/lib/local-demo-runtime.ts');
  await assert.rejects(wrong.assertLocalDemo());
});
test('random profiles stay in the requested corridor and pass normal vehicle/service validation', () => {
  const load = loader(), { demoIdentity, demoSelection, demoFields } = load('src/lib/local-rider-demo.ts'), { validateApplication } = load('src/lib/rider-application-policy.ts');
  const addresses = new Set();
  for (let index = 0; index < 60; index++) {
    const identity = demoIdentity(), choice = demoSelection(), fields = demoFields(choice.vehicleClass, identity.name);
    assert(identity.email.endsWith('@rider-demo.example.invalid')); assert(identity.name.startsWith('Demo '));
    assert(/Lingayen|Binmaley|Dagupan City/.test(fields.address)); assert(fields.licenceNumber.startsWith('DEMO-')); addresses.add(fields.address);
    validateApplication(choice.vehicleClass, choice.services, fields);
  }
  assert(addresses.size > 15);
});
test('local storage scopes documents and captures only fictional email recipients', async () => {
  const env = environment(), { writeLocalDocument, readLocalDocument, captureLocalMail, localMailbox } = loader(env)('src/lib/local-demo-files.ts');
  const pathname = `rider-applications/fixture-application/${randomUUID()}.pdf`;
  try {
    await writeLocalDocument(pathname, Buffer.from('fixture')); assert.equal((await readLocalDocument(pathname)).toString(), 'fixture');
    await assert.rejects(readLocalDocument('../../outside.pdf'));
    await assert.rejects(captureLocalMail({ to: 'real@gmail.com', text: 'Not allowed' }));
    await captureLocalMail({ to: 'rider-test@rider-demo.example.invalid', subject: 'Local test', text: 'Local mailbox only' });
    assert.equal((await localMailbox('rider-test@rider-demo.example.invalid')).length, 1);
    assert.equal((await localMailbox('someone-else@rider-demo.example.invalid')).length, 0);
  } finally {
    const file = path.resolve(env.LOCAL_DEMO_DIRECTORY), safe = path.resolve(__dirname, '../tmp/local-rider-lab') + path.sep;
    assert(file.startsWith(safe) && /^fetch_rider_lab_[a-f0-9]{32}$/.test(path.basename(file)));
    await fs.rm(file, { recursive: true, force: true });
  }
});
test('all sample document types are readable single-page PDFs permanently labeled DEMO', async () => {
  const load = loader(), { demoFields, demoDocument } = load('src/lib/local-rider-demo.ts'), { DOCUMENT_LABELS } = load('src/lib/rider-application-policy.ts');
  for (const kind of Object.keys(DOCUMENT_LABELS).filter(k => k !== 'PROFILE')) {
    const bytes = await demoDocument(kind, demoFields('TRICYCLE', 'Demo Test Rider'), 'TRICYCLE');
    assert(bytes.length < 3 * 1024 * 1024);
    const pdf = await PDFDocument.load(bytes); assert.equal(pdf.getPageCount(), 1); assert(pdf.getTitle().startsWith('DEMO / NOT VALID'));
  }
});
