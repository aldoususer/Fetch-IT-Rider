import { NextRequest, NextResponse } from 'next/server';
import { assertLocalDemo } from '@/lib/local-demo-runtime';
import { localMailbox } from '@/lib/local-demo-files';
import { demoIdentity, demoSelection, demoFields, demoDocument, demoPortrait } from '@/lib/local-rider-demo';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { applicantRequest } from '@/lib/application-applicant-api';
import { applicationDetail, publicApplication } from '@/lib/rider-application';
import { readApplicationBody } from '@/lib/application-staff-api';
import { SECTION_FIELDS, requiredDocuments, validateApplication, type Fields, type Review } from '@/lib/rider-application-policy';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
async function ownApplication() {
  const session = await getSession();
  if (!session || session.role !== 'RIDER') throw Error('Sign in as a local demo rider first.');
  const app = await db.riderApplication.findUnique({ where: { userId: session.uid }, include: applicationDetail });
  if (!app || !app.user.email.endsWith('@rider-demo.example.invalid')) throw Error('Use a fictional local demo account.');
  return app;
}
export async function GET(req: NextRequest) {
  try {
    await assertLocalDemo(req);
    if (req.nextUrl.searchParams.has('inbox')) { const app = await ownApplication(); return NextResponse.json({ messages: await localMailbox(app.user.email) }, { headers }); }
    return NextResponse.json({ enabled: true, adminUrl: process.env.LOCAL_DEMO_ADMIN_URL, riderUrl: process.env.LOCAL_DEMO_RIDER_URL }, { headers });
  } catch { return NextResponse.json({ enabled: false }, { status: 404, headers }); }
}
export async function POST(req: NextRequest) {
  try { await assertLocalDemo(req); } catch { return NextResponse.json({ error: 'Not found.' }, { status: 404, headers }); }
  try {
    const body = await readApplicationBody(req, 4096);
    if (body.action === 'account') {
      const identity = demoIdentity();
      const result = await fetch(new URL('/api/auth/signup', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: req.nextUrl.origin }, body: JSON.stringify({ ...identity, role: 'RIDER' }), cache: 'no-store' });
      const data = await result.json();
      const response = NextResponse.json({ ...data, demoEmail: identity.email }, { status: result.status, headers });
      const cookie = result.headers.get('set-cookie'); if (cookie) response.headers.set('Set-Cookie', cookie);
      return response;
    }
    let app = await ownApplication();
    if (!['DRAFT', 'NEEDS_CORRECTION'].includes(app.status)) throw Error('This demo application is already with the reviewers.');
    async function normal(body: Record<string, unknown>) {
      const result = await applicantRequest(new NextRequest(new URL('/api/rider/application', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: app.version, ...body }) }), app.userId);
      const data = await result.json(); if (!result.ok) throw Error(data.error || 'Demo request failed.');
      if (data.application) app = await db.riderApplication.findUniqueOrThrow({ where: { id: app.id }, include: applicationDetail });
    }
    async function fillDetails(onlyMissing = false) {
      const previous = app.fields as Fields;
      if (onlyMissing) { try { validateApplication(app.vehicleClass, app.services, previous); return false; } catch { /* Fill the incomplete draft. */ } }
      const generated = demoFields(app.vehicleClass, previous.legalName || app.user.name), fields = { ...previous };
      for (const [section, keys] of Object.entries(SECTION_FIELDS)) {
        if (app.status === 'NEEDS_CORRECTION' && (app.fieldReviews as Record<string, Review>)[section]?.status !== 'NEEDS_CORRECTION') continue;
        for (const key of keys) fields[key] = generated[key];
      }
      fields.registrationStep = 'details';
      await normal({ action: 'save', fields, vehicleClass: app.vehicleClass, services: app.services });
      return true;
    }
    async function fillDocuments(onlyMissing = false) {
      const portrait = await demoPortrait();
      for (const kind of requiredDocuments(app.vehicleClass, app.services, app.fields as Fields)) {
        const current = app.documents.find(d => d.current && d.kind === kind);
        if (app.status === 'NEEDS_CORRECTION' && current && current.status !== 'NEEDS_CORRECTION') continue;
        if (onlyMissing && current && current.status !== 'NEEDS_CORRECTION') continue;
        const bytes = await demoDocument(kind, app.fields as Fields, app.vehicleClass, portrait), form = new FormData();
        form.set('file', new File([new Uint8Array(bytes)], kind + (kind === 'PROFILE' ? '.png' : '.pdf'), { type: kind === 'PROFILE' ? 'image/png' : 'application/pdf' }));
        form.set('kind', kind); form.set('version', String(app.version));
        if (kind === 'NBI') form.set('expiresAt', (app.fields as Fields).nbiExpiry);
        if (kind.startsWith('LICENCE')) form.set('expiresAt', (app.fields as Fields).licenceExpiry);
        const result = await applicantRequest(new NextRequest(new URL('/api/rider/application', req.url), { method: 'POST', body: form }), app.userId);
        const data = await result.json(); if (!result.ok) throw Error(data.error || 'Demo upload failed.');
        app = await db.riderApplication.findUniqueOrThrow({ where: { id: app.id }, include: applicationDetail });
      }
    }
    if (body.action === 'verify') {
      if (!app.emailVerifiedAt) {
        await normal({ action: 'send-code' });
        const mail = (await localMailbox(app.user.email)).find(m => m.subject.includes('verification') || m.subject.includes('Verify'));
        const code = mail?.text.match(/code is (\d{6})/)?.[1]; if (!code) throw Error('Local verification message not found.');
        await normal({ action: 'verify-code', code });
      }
    } else if (body.action === 'vehicle') {
      if (app.status !== 'DRAFT') throw Error('Keep the vehicle selection during corrections.');
      await normal({ action: 'save', ...demoSelection(), fields: { ...app.fields as Fields, registrationStep: 'vehicle' } });
    } else if (body.action === 'details') await fillDetails();
    else if (body.action === 'documents') { await fillDetails(true); await fillDocuments(); }
    else if (body.action === 'review') { const changed = await fillDetails(true); await fillDocuments(!changed); await normal({ action: 'save', vehicleClass: app.vehicleClass, services: app.services, fields: { ...app.fields as Fields, registrationStep: 'review' } }); }
    else throw Error('Choose a demo step.');
    return NextResponse.json({ application: publicApplication(app), message: 'Demo data saved through the normal application flow.' }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Demo action failed.' }, { status: 400, headers }); }
}
