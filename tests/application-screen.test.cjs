const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./helpers/load-local-demo.cjs');
const guide = loader()('src/lib/rider-registration.ts');
const source = fs.readFileSync(path.resolve(__dirname, '../src/components/fetchit/rider/application-waiting.tsx'), 'utf8');
const exportsObject = {};
new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText)(exportsObject, require);
const render = (status, rest = {}) => renderToStaticMarkup(React.createElement(exportsObject.ApplicationWaiting, {
  application: { id: 'test-application', status, ...rest }, email: 'rider@example.invalid', refreshing: false, error: '', onRefresh() {}, onSignOut() {},
}));

test('submitted applications wait, approved riders enter the dashboard, and requested corrections reopen the form', () => {
  for (const status of ['SUBMITTED', 'IN_REVIEW', 'RECOMMENDED', 'ORIENTATION_SCHEDULED', 'ASSESSED', 'DEMO_COMPLETED', 'FORCE_APPROVAL_PENDING', 'REJECTED']) {
    assert.equal(guide.registrationScreen(status, false), 'waiting');
  }
  assert.equal(guide.registrationScreen('DRAFT', false), 'application');
  assert.equal(guide.registrationScreen('ACTIVE', true), 'dashboard');
  assert.equal(guide.registrationScreen('DRAFT', true), 'dashboard'); // Existing working rider with legacy access.
  assert.equal(guide.registrationScreen('NEEDS_CORRECTION', false), 'application');
  assert.equal(guide.registrationScreen('NEEDS_CORRECTION', true), 'application');
  assert.equal(guide.registrationScreen('ACTIVE', false), 'waiting'); // Expired or revoked approvals do not open the dashboard.
});

test('the waiting screen has one update action and no document or registration form', () => {
  const html = render('SUBMITTED');
  assert(html.includes('Check your email for confirmation and updates.'));
  assert(html.includes('rider@example.invalid'));
  assert(html.includes('Application received'));
  assert.equal((html.match(/Check for updates/g) || []).length, 1);
  assert(!html.includes('<input')); assert(!html.includes('Save &amp; continue'));
  assert(!html.includes('Application &amp; service approvals'));
});

test('the compact screen distinguishes rejection, current orientation and missing service access', () => {
  const orientation = { orientationAt: '2026-11-01T01:00:00Z', orientationVenue: 'Orientation room', orientationInstructions: 'Bring your originals.' };
  const html = render('ORIENTATION_SCHEDULED', orientation);
  assert(html.includes('Orientation room')); assert(html.includes('Bring your originals.')); assert(html.includes('?letter=1'));
  assert(render('REJECTED', orientation).includes('Application not approved'));
  assert(!render('REJECTED', orientation).includes('?letter=1'));
  assert(render('ACTIVE').includes('no current service access'));
});

test('a review transition resumes the flagged document step and hides the form again on resubmission', () => {
  const app = { status: 'SUBMITTED', emailVerifiedAt: '2026-10-29', vehicleClass: 'MOTORCYCLE', services: ['DELIVERY'], fields: { registrationStep: 'review' }, fieldReviews: {}, documents: [] };
  assert.equal(guide.registrationScreen(app.status, false), 'waiting');
  app.status = 'NEEDS_CORRECTION'; app.documents = [{ id: 'receipt', kind: 'OR', current: true, status: 'NEEDS_CORRECTION' }];
  assert.equal(guide.registrationScreen(app.status, false), 'application');
  assert.equal(guide.resumeRegistration(app), 3);
  app.status = 'SUBMITTED'; assert.equal(guide.registrationScreen(app.status, false), 'waiting');
  app.status = 'ACTIVE'; assert.equal(guide.registrationScreen(app.status, true), 'dashboard');
});
