import { db } from './db';
import { applicationDetail, applicationEvent, ensureApplication, lockApplication } from './rider-application';
import { ApplicationError, normalizeFields } from './rider-application-policy';

export async function changeApplicationDemoMode(userId: string, version: unknown, enabled: boolean) {
  const initial = await ensureApplication(userId);
  return db.$transaction(async tx => {
    const app = await lockApplication(tx, initial.id, version);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    if (await tx.riderServiceApproval.count({ where: { userId } }) || await tx.booking.count({ where: { riderId: userId } })) throw new ApplicationError('An existing working rider account cannot use the application demo.', 409);
    if (enabled) {
      if (app.status !== 'DRAFT' || app.isDemo || app.documents.some(d => d.current) || app.submittedAt) throw new ApplicationError('Use a fresh draft without documents for the demo.', 409);
      if (!app.emailVerifiedAt || app.verifiedEmail !== app.user.email) throw new ApplicationError('Verify your own email before using the demo.');
    } else if (!app.isDemo) throw new ApplicationError('This is already a real application.', 409);
    // Keep a private recovery snapshot; trying a demo must not discard an existing real draft.
    const previousDemo = !enabled ? await tx.riderApplicationEvent.findFirst({ where: { applicationId: app.id, action: 'DEMO_STARTED' }, orderBy: { createdAt: 'desc' }, select: { details: true } }) : null;
    const realDraft = (previousDemo?.details as { realDraft?: { fields: Record<string, string>; vehicleClass: typeof app.vehicleClass; services: typeof app.services } } | null)?.realDraft;
    // Retain history privately, but no sample upload or review can carry into a real application.
    await tx.riderApplicationDocument.updateMany({ where: { applicationId: app.id, current: true }, data: { current: false } });
    const saved = await tx.riderApplication.update({ where: { id: app.id }, data: {
      isDemo: enabled, status: 'DRAFT', fields: !enabled && realDraft ? { ...normalizeFields(realDraft.fields), registrationStep: 'details' } : { legalName: app.user.name, registrationStep: 'vehicle' }, fieldReviews: {},
      vehicleClass: !enabled && realDraft ? realDraft.vehicleClass : 'MOTORCYCLE', services: !enabled && realDraft ? realDraft.services : ['DELIVERY'],
      assignedToId: null, recommendedById: null, recommendedAt: null, submittedAt: null,
      orientationAt: null, orientationVenue: null, orientationInstructions: null,
      attendedAt: null, assessmentPassedAt: null, assessmentNotes: null, assessedById: null,
      version: { increment: 1 },
    }, include: applicationDetail });
    await applicationEvent(tx, app.id, { id: userId, name: app.user.name, role: 'RIDER' }, enabled ? 'DEMO_STARTED' : 'REAL_APPLICATION_STARTED', { previousUploadsArchived: true, ...(enabled ? { realDraft: { fields: app.fields, vehicleClass: app.vehicleClass, services: app.services } } : {}) });
    return saved;
  }, { maxWait: 10000, timeout: 20000 });
}
