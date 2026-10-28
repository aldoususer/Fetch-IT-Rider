const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/load-local-demo.cjs');
const { readApplicationJson } = loader()('src/lib/application-client-response.ts');
test('gateway timeouts preserve a clear resume message without exposing parser or proxy text', async () => {
  await assert.rejects(readApplicationJson(new Response('An error occurred PRIVATE_PROXY_RESPONSE', { status: 504 })), error => error.message.includes('timed out') && error.message.includes('resume') && !error.message.includes('PRIVATE') && !error.message.includes('Unexpected token'));
  await assert.rejects(readApplicationJson(new Response('<html>PRIVATE_GATEWAY_PAGE</html>', { status: 502 })), error => error.message.includes('saved progress') && !error.message.includes('PRIVATE'));
  await assert.rejects(readApplicationJson(new Response('{"broken":', { status: 200, headers: { 'Content-Type': 'application/json' } })), /saved progress/);
});
test('valid application and validation-error JSON remain available to normal UI handling', async () => {
  assert.deepEqual(await readApplicationJson(Response.json({ application: { version: 7 }, demoContinue: true, demoProgress: { completed: 1, total: 6 } })), { application: { version: 7 }, demoContinue: true, demoProgress: { completed: 1, total: 6 } });
  assert.deepEqual(await readApplicationJson(Response.json({ error: 'Replace only the flagged document.' }, { status: 409 })), { error: 'Replace only the flagged document.' });
});
