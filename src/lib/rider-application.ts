import { db } from "./db";
import type { Prisma, RiderApplication, RiderApplicationDocument } from "@prisma/client";
import { ApplicationError, SECTION_FIELDS, DOCUMENT_LABELS, normalizeFields, requiredDocuments, validateApplication, validateSelection, approvalExpiry, type Fields, type Review } from "./rider-application-policy";
import { liveApprovalWhere, validOperatingZone } from "./rider-eligibility";
import { assertRealApplication } from './application-demo-policy';

export type ApplicationActor = { id: string; name: string; role: string };
export const canReviewApplications = (role: string) => ["ADMIN", "SAFETY", "SUPERADMIN"].includes(role);
export const canActivateApplications = (role: string) => ["ADMIN", "SUPERADMIN"].includes(role);
const detail = { documents: { orderBy: { createdAt: "desc" as const } }, events: { orderBy: { createdAt: "desc" as const }, take: 80 }, emails: { orderBy: { createdAt: "desc" as const }, take: 20 }, user: { select: { id: true, name: true, email: true, isBanned: true } } };
export const applicationDetail = detail;
export type ApplicationDetail = Prisma.RiderApplicationGetPayload<{ include: typeof detail }>;
export function publicApplication(app: ApplicationDetail, staff = false) {
  return { ...app, documents: app.documents.map(({ pathname: _path, ...doc }) => doc), emails: app.emails.map(({ payload: _payload, recipient: _recipient, ...email }) => email), events: staff ? app.events : app.events.map(({ details: _details, ...event }) => event) };
}
export async function ensureApplication(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { riderProfile: true } });
  if (!user || user.role !== "RIDER" || user.isBanned) throw new ApplicationError("Rider account unavailable.", 403);
  return db.riderApplication.upsert({ where: { userId }, update: {}, create: { userId, vehicleClass: ["MOTORCYCLE", "TRICYCLE", "SEDAN"].includes(user.riderProfile?.vehicleClass ?? "") ? user.riderProfile!.vehicleClass : "MOTORCYCLE", services: ["DELIVERY"], fields: { legalName: user.name, mobile: user.phone ?? "", plateNumber: user.riderProfile?.vehiclePlate ?? "" } }, include: detail });
}
export async function lockApplication(tx: Prisma.TransactionClient, id: string, version: unknown) {
  await tx.$queryRaw`SELECT "id" FROM "RiderApplication" WHERE "id"=${id} FOR UPDATE`;
  const app = await tx.riderApplication.findUnique({ where: { id }, include: detail });
  if (!app) throw new ApplicationError("Application not found.", 404);
  if (app.version !== version) throw new ApplicationError("This application changed. Refresh before continuing.", 409);
  return app;
}
export async function applicationEvent(tx: Prisma.TransactionClient, id: string, actor: ApplicationActor, action: string, details: Prisma.InputJsonValue = {}) {
  await tx.riderApplicationEvent.create({ data: { applicationId: id, actorId: actor.id, actorName: actor.name, action, details } });
  if (actor.role !== "RIDER") await tx.adminAudit.create({ data: { actorId: actor.id, actorName: actor.name, action: `APPLICATION_${action}`, entityType: "RIDER_APPLICATION", entityId: id, details } });
}
export function requireEditable(app: RiderApplication) {
  if (!["DRAFT", "NEEDS_CORRECTION"].includes(app.status)) throw new ApplicationError("This application is locked while it is being reviewed.", 409);
}
export async function removeApplicationDocument(userId: string, version: unknown, documentId: unknown) {
  const initial = await ensureApplication(userId);
  return db.$transaction(async tx => {
    const app = await lockApplication(tx, initial.id, version);
    requireEditable(app);
    const doc = app.documents.find(d => d.id === documentId && d.current);
    if (!doc) throw new ApplicationError("Current document not found.", 404);
    if (doc.status !== "PENDING") throw new ApplicationError("Only unreviewed uploads can be removed. Replace documents marked Needs correction.", 409);
    // Archive the accidental upload; keep private history and any required correction.
    const flagged = app.status === "NEEDS_CORRECTION"
      ? app.documents.filter(d => !d.current && d.kind === doc.kind && d.status === "NEEDS_CORRECTION" && d.reviewedAt && app.submittedAt && d.reviewedAt >= app.submittedAt).sort((a, b) => b.version - a.version)[0]
      : undefined;
    await tx.riderApplicationDocument.update({ where: { id: doc.id }, data: { current: false } });
    if (flagged) await tx.riderApplicationDocument.update({ where: { id: flagged.id }, data: { current: true } });
    await tx.riderApplication.update({ where: { id: app.id }, data: { version: { increment: 1 } } });
    await applicationEvent(tx, app.id, { id: userId, name: app.user.name, role: "RIDER" }, "DOCUMENT_REMOVED", { documentId: doc.id, kind: doc.kind, ...(flagged ? { restoredDocumentId: flagged.id } : {}) });
    return tx.riderApplication.findUniqueOrThrow({ where: { id: app.id }, include: detail });
  }, { maxWait: 10000, timeout: 20000 });
}
export async function saveApplication(userId: string, body: Record<string, unknown>) {
  const initial = await ensureApplication(userId);
  return db.$transaction(async tx => {
    const app = await lockApplication(tx, initial.id, body.version); requireEditable(app);
    const fields = normalizeFields(body.fields);
    validateSelection(body.vehicleClass, body.services);
    const vehicleClass = body.vehicleClass as "MOTORCYCLE" | "TRICYCLE" | "SEDAN", services = body.services as ("DELIVERY" | "RIDE")[];
    const previous = app.fields as Fields, reviews = { ...app.fieldReviews as Record<string, Review> };
    if (app.status === "NEEDS_CORRECTION" && (vehicleClass !== app.vehicleClass || JSON.stringify(services) !== JSON.stringify(app.services))) throw new ApplicationError("Vehicle and service changes need a fresh review. Contact the reviewing team.");
    for (const [section, keys] of Object.entries(SECTION_FIELDS)) {
      if (!keys.some(key => fields[key] !== (previous[key] ?? ""))) continue;
      if (app.status === "NEEDS_CORRECTION" && reviews[section]?.status !== "NEEDS_CORRECTION") throw new ApplicationError("Only details marked Needs correction can be changed.");
      reviews[section] = { status: "PENDING" };
    }
    if (body.submit) {
      validateApplication(vehicleClass, services, fields);
      if (!app.emailVerifiedAt || app.verifiedEmail !== app.user.email) throw new ApplicationError("Verify your email before submitting.");
      for (const kind of requiredDocuments(vehicleClass, services, fields)) {
        const doc = app.documents.find(d => d.current && d.kind === kind);
        if (!doc || doc.status === "NEEDS_CORRECTION") throw new ApplicationError(`Upload ${DOCUMENT_LABELS[kind]}.`);
      }
      if (Object.values(reviews).some(review => review.status === "NEEDS_CORRECTION")) throw new ApplicationError("Correct each flagged section before resubmitting.");
    }
    const saved = await tx.riderApplication.update({ where: { id: app.id }, data: { fields, fieldReviews: reviews as Prisma.InputJsonValue, vehicleClass, services, version: { increment: 1 }, ...(body.submit ? { status: "SUBMITTED", submittedAt: new Date(), recommendedAt: null, recommendedById: null } : {}) }, include: detail });
    await applicationEvent(tx, app.id, { id: userId, name: app.user.name, role: "RIDER" }, body.submit ? "SUBMITTED" : "DRAFT_SAVED");
    return saved;
  });
}
export function applicationReady(app: ApplicationDetail) {
  const f = app.fields as Fields; validateApplication(app.vehicleClass, app.services, f);
  if (!app.emailVerifiedAt || app.verifiedEmail !== app.user.email) throw new ApplicationError("Applicant email is not verified.");
  const reviews = app.fieldReviews as Record<string, Review>;
  for (const section of Object.keys(SECTION_FIELDS)) if (reviews[section]?.status !== "ACCEPTED") throw new ApplicationError(`Accept the ${section} details first.`);
  for (const kind of requiredDocuments(app.vehicleClass, app.services, f)) if (!app.documents.some(d => d.current && d.kind === kind && d.status === "ACCEPTED" && (!d.expiresAt || d.expiresAt > new Date()))) throw new ApplicationError(`Accept a valid ${DOCUMENT_LABELS[kind]} first.`);
  if (app.documents.some(d => d.current && ["PENDING", "NEEDS_CORRECTION"].includes(d.status))) throw new ApplicationError("Review every uploaded document, including additional documents.");
}
function reason(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 5 || value.length > 2000) throw new ApplicationError("Explain the decision in 5–2000 characters.");
  return value.trim();
}
function invitationPayload(app: ApplicationDetail, at: Date, venue: string, instructions: string) {
  return { name: (app.fields as Fields).legalName, applicationId: app.id, vehicle: app.vehicleClass, services: app.services.join(" / "), date: at.toISOString(), venue, instructions, demo: app.isDemo };
}
export async function reviewApplication(id: string, actor: ApplicationActor, body: Record<string, unknown>) {
  if (!canReviewApplications(actor.role)) throw new ApplicationError("Application reviewer access required.", 403);
  return db.$transaction(async tx => {
    const app = await lockApplication(tx, id, body.version);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${app.userId} FOR UPDATE`;
    if (app.user.isBanned) throw new ApplicationError("This account is restricted.", 403);
    const admin = canActivateApplications(actor.role);
    if (body.action === "claim") {
      if (app.assignedToId && app.assignedToId !== actor.id) throw new ApplicationError("Another reviewer has claimed this application.", 409);
    } else if (!admin && app.assignedToId !== actor.id) throw new ApplicationError("Claim this application before reviewing it.", 403);
    const data: Prisma.RiderApplicationUpdateInput = { version: { increment: 1 } };
    let eventDetails: Prisma.InputJsonValue = {};
    const reviewStates = ["SUBMITTED", "IN_REVIEW"];
    if (body.action === "claim") {
      if (!reviewStates.includes(app.status)) throw new ApplicationError("This application is not ready for review.", 409);
      data.assignedToId = actor.id; data.status = "IN_REVIEW";
    } else if (body.action === "review") {
      if (!reviewStates.includes(app.status)) throw new ApplicationError("Wait for submission before reviewing documents.", 409);
      if (!["ACCEPTED", "NEEDS_CORRECTION", "NOT_APPLICABLE"].includes(String(body.status))) throw new ApplicationError("Choose a valid document status.");
      const status = body.status as Review["status"];
      const note = status === "NEEDS_CORRECTION" ? reason(body.reason) : "";
      if (typeof body.documentId === "string") {
        const doc = app.documents.find(d => d.id === body.documentId && d.current);
        if (!doc) throw new ApplicationError("Current document not found.", 404);
        if (status === "NOT_APPLICABLE" && requiredDocuments(app.vehicleClass, app.services, app.fields as Fields).includes(doc.kind)) throw new ApplicationError("A required document cannot be marked Not applicable.");
        if (status === "ACCEPTED" && doc.expiresAt && doc.expiresAt <= new Date()) throw new ApplicationError("Expired documents cannot be accepted.");
        await tx.riderApplicationDocument.update({ where: { id: doc.id }, data: { status, reason: note || null, reviewedById: actor.id, reviewedAt: new Date() } });
        eventDetails = { kind: doc.kind, documentId: doc.id, status, reason: note };
      } else {
        const section = String(body.section);
        if (!Object.hasOwn(SECTION_FIELDS, section) || status === "NOT_APPLICABLE") throw new ApplicationError("Choose a valid details section.");
        data.fieldReviews = { ...app.fieldReviews as Record<string, Prisma.InputJsonValue>, [section]: { status, reason: note, reviewerId: actor.id } };
        eventDetails = { section, status, reason: note };
      }
      data.status = "IN_REVIEW";
    } else if (body.action === "corrections") {
      if (!reviewStates.includes(app.status)) throw new ApplicationError("This application is not being reviewed.", 409);
      const corrections = [...app.documents.filter(d => d.current && d.status === "NEEDS_CORRECTION").map(d => `${DOCUMENT_LABELS[d.kind]}: ${d.reason}`), ...Object.entries(app.fieldReviews as Record<string, Review>).filter(([,r]) => r.status === "NEEDS_CORRECTION").map(([key,r]) => `${key}: ${r.reason}`)];
      if (!corrections.length) throw new ApplicationError("Flag at least one item and explain its correction first.");
      data.status = "NEEDS_CORRECTION";
      await tx.riderApplicationEmail.create({ data: { applicationId: id, sourceId: `${id}:${app.version}:CORRECTIONS`, kind: "CORRECTIONS", recipient: app.user.email, payload: { name: (app.fields as Fields).legalName || app.user.name, applicationId: id, corrections, demo: app.isDemo } } });
    } else if (body.action === "recommend") {
      if (!reviewStates.includes(app.status)) throw new ApplicationError("This application is not being reviewed.", 409);
      applicationReady(app); data.status = "RECOMMENDED"; data.recommendedById = actor.id; data.recommendedAt = new Date();
    } else if (body.action === "schedule") {
      if (!admin || !["RECOMMENDED", "ORIENTATION_SCHEDULED", "ASSESSED"].includes(app.status)) throw new ApplicationError("An admin must schedule an application recommended for approval.", 403);
      if (app.recommendedById === actor.id) throw new ApplicationError("A different admin must approve the recommendation.", 403);
      applicationReady(app);
      const at = new Date(String(body.orientationAt));
      if (!Number.isFinite(at.getTime()) || at <= new Date()) throw new ApplicationError("Choose a future orientation time.");
      const venue = reason(body.venue), instructions = reason(body.instructions);
      data.status = "ORIENTATION_SCHEDULED"; data.orientationAt = at; data.orientationVenue = venue; data.orientationInstructions = instructions;
      data.attendedAt = null; data.assessmentPassedAt = null; data.assessedById = null; data.assessmentNotes = null;
      await tx.riderApplicationEmail.create({ data: { applicationId: id, sourceId: `${id}:${app.version}:ORIENTATION`, kind: "ORIENTATION", recipient: app.user.email, payload: invitationPayload(app, at, venue, instructions) } });
      eventDetails = { orientationAt: at.toISOString(), venue };
    } else if (body.action === "assessment") {
      if (!["ORIENTATION_SCHEDULED", "ASSESSED"].includes(app.status) || !app.orientationAt || app.orientationAt > new Date()) throw new ApplicationError("Record attendance after the scheduled orientation begins.");
      if (typeof body.attended !== "boolean" || typeof body.passed !== "boolean" || (body.passed && !body.attended)) throw new ApplicationError("Confirm attendance and assessment result.");
      const notes = reason(body.notes);
      data.status = body.attended && body.passed ? "ASSESSED" : "ORIENTATION_SCHEDULED";
      data.attendedAt = body.attended ? new Date() : null; data.assessmentPassedAt = body.passed ? new Date() : null; data.assessedById = actor.id; data.assessmentNotes = notes;
      eventDetails = { attended: body.attended, passed: body.passed, notes };
    } else if (body.action === "activate" || body.action === 'complete-demo') {
      if (body.action === 'activate') assertRealApplication(app);
      else if (!app.isDemo) throw new ApplicationError('Only a demo application can complete the demo.', 403);
      if (!admin || !["ASSESSED", "ACTIVE"].includes(app.status)) throw new ApplicationError("An admin can activate services after the assessment passes.", 403);
      if (app.recommendedById === actor.id || app.assessedById === actor.id) throw new ApplicationError("A different admin must confirm the review and assessment.", 403);
      applicationReady(app);
      if (!app.attendedAt || !app.assessmentPassedAt) throw new ApplicationError("Record successful orientation and assessment first.");
      const services = body.services as string[];
      if (!Array.isArray(services) || !services.length || services.some(s => !app.services.includes(s as "DELIVERY"))) throw new ApplicationError("Choose services from this application.");
      if (new Set(services).size !== services.length) throw new ApplicationError("Choose each service only once.");
      const alreadyApproved = await tx.riderServiceApproval.findFirst({ where: { userId: app.userId, vehicleClass: app.vehicleClass, service: { in: services as ("DELIVERY" | "RIDE")[] }, source: "APPLICATION", ...liveApprovalWhere() } });
      if (alreadyApproved) throw new ApplicationError("A selected service is already active. Choose only services awaiting activation.", 409);
      const expiry = approvalExpiry(app.fields as Fields);
      if (!app.isDemo && app.vehicleClass === "TRICYCLE" && services.includes("RIDE") && !validOperatingZone(body.operatingZone)) throw new ApplicationError("Provide the verified tricycle operating-zone polygon as a closed array of [longitude, latitude] points.");
      for (const service of app.isDemo ? [] : services) {
        const zone = app.vehicleClass === "TRICYCLE" && service === "RIDE" ? { operatingZone: body.operatingZone as Prisma.InputJsonValue } : {};
        await tx.riderServiceApproval.upsert({ where: { userId_vehicleClass_service: { userId: app.userId, vehicleClass: app.vehicleClass, service: service as "DELIVERY" } }, create: { userId: app.userId, vehicleClass: app.vehicleClass, service: service as "DELIVERY", source: "APPLICATION", approvedById: actor.id, validUntil: expiry, ...zone }, update: { source: "APPLICATION", approvedById: actor.id, approvedAt: new Date(), validUntil: expiry, revokedAt: null, ...zone } });
      }
      if (!app.isDemo) await tx.riderProfile.update({ where: { userId: app.userId }, data: { vehicleClass: app.vehicleClass, vehiclePlate: (app.fields as Fields).plateNumber } });
      data.status = app.isDemo ? 'DEMO_COMPLETED' : "ACTIVE";
      eventDetails = { services, vehicle: app.vehicleClass, validUntil: expiry.toISOString() };
      await tx.riderApplicationEmail.create({ data: { applicationId: id, sourceId: `${id}:${app.version}:ACTIVATED`, kind: "ACTIVATED", recipient: app.user.email, payload: { name: (app.fields as Fields).legalName, applicationId: id, vehicle: app.vehicleClass, services: services.join(" / "), demo: app.isDemo } } });
    } else if (body.action === "reopen") {
      if (!admin) throw new ApplicationError("Admin access required.", 403);
      const note = reason(body.reason);
      if (await tx.booking.count({ where: { riderId: app.userId, status: { in: ["MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } } })) throw new ApplicationError("Resolve active assignments before reopening the application.", 409);
      await tx.riderServiceApproval.updateMany({ where: { userId: app.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.riderPresence.updateMany({ where: { userId: app.userId }, data: { isOnline: false } });
      data.status = "DRAFT"; data.fieldReviews = {}; data.assignedToId = null; data.recommendedById = null; data.recommendedAt = null; data.attendedAt = null; data.assessmentPassedAt = null; data.assessedById = null; data.assessmentNotes = null; data.orientationAt = null; data.orientationVenue = null; data.orientationInstructions = null;
      await tx.riderApplicationDocument.updateMany({ where: { applicationId: id, current: true }, data: { status: "PENDING", reviewedAt: null, reviewedById: null, reason: null } });
      eventDetails = { reason: note };
    } else throw new ApplicationError("Choose a valid review action.");
    await tx.riderApplication.update({ where: { id }, data });
    await applicationEvent(tx, id, actor, String(body.action).toUpperCase(), eventDetails);
    return tx.riderApplication.findUniqueOrThrow({ where: { id }, include: detail });
  }, { maxWait: 10000, timeout: 20000 });
}
export async function riderApprovals(userId: string) { return db.riderServiceApproval.findMany({ where: { userId, ...liveApprovalWhere() } }); }
export type UploadedDocument = Pick<RiderApplicationDocument, "kind" | "pathname" | "mimeType" | "issuedAt" | "expiresAt">;
