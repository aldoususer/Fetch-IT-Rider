import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { db } from '@/lib/db';
import { applicationDetail, publicApplication } from '@/lib/rider-application';
import { applicantRequest } from '@/lib/application-applicant-api';
import { applicationErrorResponse, readApplicationBody } from '@/lib/application-staff-api';
import { ApplicationError, SECTION_FIELDS, requiredDocuments, validateApplication, type Fields, type Review } from '@/lib/rider-application-policy';
import { demoSelection, demoFields, demoDocument, demoPortrait } from '@/lib/rider-demo-data';
import { limitRequests, withRequestLog } from '@/lib/request-guard';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  try {
    if (req.headers.get('origin') !== req.nextUrl.origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new ApplicationError('This request is not allowed.', 403);
    const session = await getSession();
    if (!session || session.role !== 'RIDER') throw new ApplicationError('Sign in with your own rider account.', 401);
    let app = await db.riderApplication.findUnique({ where: { userId: session.uid }, include: applicationDetail });
    if (!app?.isDemo || app.user.isBanned) throw new ApplicationError('Start a demo application first.', 403);
    if (!app.emailVerifiedAt || app.verifiedEmail !== app.user.email) throw new ApplicationError('Verify your own email first. The demo never bypasses email verification.', 403);
    if (!['DRAFT', 'NEEDS_CORRECTION'].includes(app.status)) throw new ApplicationError('Wait for review before changing this application.', 409);
    const body = await readApplicationBody(req, 4096);
    if (body.version !== app.version) throw new ApplicationError('This application changed. Refresh before continuing.', 409);
    if (!['vehicle', 'details', 'documents', 'review'].includes(String(body.action))) throw new ApplicationError('Choose a demo step.');
    await limitRequests('rider:demo-step', session.uid, 20, 3600_000);
    async function normal(value: Record<string, unknown>) {
      const result = await applicantRequest(new NextRequest(new URL('/api/rider/application', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: app!.version, ...value }) }), session!.uid);
      const data = await result.json(); if (!result.ok) throw new ApplicationError(data.error || 'Demo action failed.', result.status);
      app = await db.riderApplication.findUniqueOrThrow({ where: { userId: session!.uid }, include: applicationDetail });
    }
    async function fillDetails(onlyMissing = false) {
      const previous = app!.fields as Fields;
      if (onlyMissing) { try { validateApplication(app!.vehicleClass, app!.services, previous); return false; } catch { /* Complete the draft through normal validation. */ } }
      const generated = demoFields(app!.vehicleClass, previous.legalName || `Demo ${app!.user.name}`), fields = { ...previous };
      for (const [section, keys] of Object.entries(SECTION_FIELDS)) {
        if (app!.status === 'NEEDS_CORRECTION' && (app!.fieldReviews as Record<string, Review>)[section]?.status !== 'NEEDS_CORRECTION') continue;
        for (const key of keys) fields[key] = generated[key];
      }
      fields.registrationStep = 'details';
      await normal({ action: 'save', fields, vehicleClass: app!.vehicleClass, services: app!.services });
      return true;
    }
    async function fillDocuments(onlyMissing: boolean) {
      const portrait = await demoPortrait();
      for (const kind of requiredDocuments(app!.vehicleClass, app!.services, app!.fields as Fields)) {
        const current = app!.documents.find(d => d.current && d.kind === kind);
        if (app!.status === 'NEEDS_CORRECTION' && current && current.status !== 'NEEDS_CORRECTION') continue;
        if (onlyMissing && current && current.status !== 'NEEDS_CORRECTION') continue;
        const bytes = await demoDocument(kind, app!.fields as Fields, app!.vehicleClass, portrait), form = new FormData();
        form.set('file', new File([new Uint8Array(bytes)], `${kind}.${kind === 'PROFILE' ? 'png' : 'pdf'}`, { type: kind === 'PROFILE' ? 'image/png' : 'application/pdf' }));
        form.set('kind', kind); form.set('version', String(app!.version));
        if (kind === 'NBI') form.set('expiresAt', (app!.fields as Fields).nbiExpiry);
        if (kind.startsWith('LICENCE')) form.set('expiresAt', (app!.fields as Fields).licenceExpiry);
        const result = await applicantRequest(new NextRequest(new URL('/api/rider/application', req.url), { method: 'POST', body: form }), session!.uid);
        const data = await result.json(); if (!result.ok) throw new ApplicationError(data.error || 'Demo upload failed.', result.status);
        app = await db.riderApplication.findUniqueOrThrow({ where: { userId: session!.uid }, include: applicationDetail });
      }
    }
    if (body.action === 'vehicle') {
      if (app.status !== 'DRAFT') throw new ApplicationError('Vehicle selection is locked during corrections.', 409);
      await normal({ action: 'save', ...demoSelection(), fields: { ...app.fields as Fields, registrationStep: 'vehicle' } });
    } else if (body.action === 'details') {
      await fillDetails();
      if (app.documents.some(d => d.current)) await fillDocuments(false);
    } else {
      const changed = await fillDetails(true); await fillDocuments(!changed);
      if (body.action === 'review') await normal({ action: 'save', vehicleClass: app.vehicleClass, services: app.services, fields: { ...app.fields as Fields, registrationStep: 'review' } });
    }
    return NextResponse.json({ application: publicApplication(app), message: 'Sample data saved. Review and submit when ready.' });
  } catch (error) { return applicationErrorResponse(error); }
}
export const POST = withRequestLog('rider:application-demo:POST', handle);
