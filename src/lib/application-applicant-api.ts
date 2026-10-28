import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { ensureApplication, publicApplication, applicationDetail, saveApplication, removeApplicationDocument, riderApprovals, lockApplication, requireEditable, applicationEvent, applicationUploadContext, applicationFilename } from "./rider-application";
import { ApplicationError, DOCUMENT_LABELS, requiredDocuments, type Fields } from "./rider-application-policy";
import { readApplicationDocument } from "./application-storage";
import { storeApplicationDocument, removeUnusedApplicationDocument } from "./application-upload";
import { applicationErrorResponse, pdfResponse, readApplicationBody } from "./application-staff-api";
import { applicationTransport, orientationLetter } from "./application-mail";
import { limitRequests, RateLimitError, safeErrorCode } from "./request-guard";
import { sessionSecret } from "./session-secret";
import { changeApplicationDemoMode } from './application-demo-mode';

const codeHash = (id: string, code: string) => createHmac("sha256", sessionSecret()).update(JSON.stringify(["rider-verify", id, code])).digest("hex");
export async function applicantRequest(req: NextRequest, userId: string) {
  const started = performance.now();
  try {
    let app = await ensureApplication(userId);
    if (req.method === "GET") {
      const docId = req.nextUrl.searchParams.get("document");
      if (docId) { const doc = app.documents.find(d => d.id === docId); if (!doc) throw new ApplicationError("Document not found.", 404); return readApplicationDocument(app.id, doc); }
      if (req.nextUrl.searchParams.has("letter")) {
        if (!app.orientationAt || !["ORIENTATION_SCHEDULED", "ASSESSED", "ACTIVE", "DEMO_COMPLETED"].includes(app.status)) throw new ApplicationError("There is no current orientation invitation.", 404);
        const email = await db.riderApplicationEmail.findFirst({ where: { applicationId: app.id, kind: "ORIENTATION" }, orderBy: { createdAt: "desc" } }); if (!email) throw new ApplicationError("Your orientation is not scheduled yet.", 404);
        return pdfResponse(await orientationLetter(email.payload as never));
      }
      const [approvals, activeJobs] = await Promise.all([riderApprovals(userId), db.booking.count({ where: { riderId: userId, status: { in: ["MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } } })]);
      return NextResponse.json({ application: publicApplication(app), approvals, canWork: approvals.length > 0 || activeJobs > 0 });
    }
    await limitRequests("rider:application-write", userId, 60, 60 * 60_000);
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      if (+(req.headers.get("content-length") ?? 0) > 3.2 * 1024 * 1024) throw new ApplicationError("Choose a document up to 3 MB.", 413);
      // Bound the stream before decoding multipart; Content-Length can be omitted.
      const reader = req.body?.getReader(); if (!reader) throw new ApplicationError("Choose a document.");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 3.2 * 1024 * 1024) { await reader.cancel(); throw new ApplicationError("Choose a document up to 3 MB.", 413); } chunks.push(value); }
      const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type")! } }).formData();
      const file = form.get("file"), kind = String(form.get("kind"));
      if (!(file instanceof File) || !Object.hasOwn(DOCUMENT_LABELS, kind)) throw new ApplicationError("Choose a valid document type and file.");
      const version = Number(form.get("version"));
      requireEditable(app);
      const current = app.documents.find(d => d.current && d.kind === kind);
      const context = form.get('uploadContext'), documentId = form.get('documentId');
      if (context !== null && (typeof context !== 'string' || !/^[a-f0-9]{64}$/.test(context) || typeof documentId !== 'string' || documentId.length > 160)) throw new ApplicationError('Refresh the application before uploading.');
      const upload = typeof context === 'string' ? { kind, context, documentId: documentId as string } : undefined;
      if (upload && (applicationUploadContext(app) !== upload.context || (current?.id ?? '') !== upload.documentId)) throw new ApplicationError('This application or document changed. Refresh before continuing.', 409);
      if (app.status === "NEEDS_CORRECTION" && (current ? current.status !== "NEEDS_CORRECTION" : !requiredDocuments(app.vehicleClass, app.services, app.fields as Fields).includes(kind))) throw new ApplicationError("Only flagged or newly required documents can be uploaded.");
      const issuedAt = form.get("issuedAt") ? new Date(String(form.get("issuedAt")) + "T00:00:00+08:00") : null;
      const expiresAt = form.get("expiresAt") ? new Date(String(form.get("expiresAt")) + "T23:59:59+08:00") : null;
      if ((issuedAt && (!Number.isFinite(issuedAt.getTime()) || issuedAt > new Date())) || (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) || (issuedAt && expiresAt && issuedAt >= expiresAt)) throw new ApplicationError("Check the document issue and expiry dates.");
      await limitRequests("rider:application-upload", userId, 35, 60 * 60_000);
      const fileStarted = performance.now();
      const saved = await storeApplicationDocument(app.id, kind, Buffer.from(await file.arrayBuffer()));
      const databaseStarted = performance.now();
      try {
        app = await db.$transaction(async tx => {
          const locked = await lockApplication(tx, app.id, version, upload); requireEditable(locked);
          const old = locked.documents.find(d => d.kind === kind && d.current);
          if (locked.status === "NEEDS_CORRECTION" && (old ? old.status !== "NEEDS_CORRECTION" : !requiredDocuments(locked.vehicleClass, locked.services, locked.fields as Fields).includes(kind))) throw new ApplicationError("Only flagged or newly required documents can be uploaded.");
          if (locked.documents.filter(d => d.kind === kind).length >= 12) throw new ApplicationError("Too many replacements. Ask the reviewing team for help.");
          await tx.riderApplicationDocument.updateMany({ where: { applicationId: app.id, kind, current: true }, data: { current: false } });
          await tx.riderApplicationDocument.create({ data: { applicationId: app.id, kind, version: Math.max(0, ...locked.documents.filter(d => d.kind === kind).map(d => d.version)) + 1, ...saved, originalName: applicationFilename(file.name), issuedAt, expiresAt } });
          await tx.riderApplication.update({ where: { id: app.id }, data: { version: { increment: 1 }, fields: { ...locked.fields as Fields, registrationStep: 'documents' } } });
          await applicationEvent(tx, app.id, { id: userId, name: app.user.name, role: "RIDER" }, "DOCUMENT_UPLOADED", { kind });
          return tx.riderApplication.findUniqueOrThrow({ where: { id: app.id }, include: applicationDetail });
        }, { maxWait: 10000, timeout: 20000 });
      } catch (error) {
        // Preserve possible committed uploads after an uncertain transaction result.
        try { if (!await db.riderApplicationDocument.findFirst({ where: { pathname: saved.pathname } })) await removeUnusedApplicationDocument(saved.pathname); } catch { /* Reconcile conservatively. */ }
        throw error;
      }
      return NextResponse.json({ application: publicApplication(app) }, { headers: { 'Server-Timing': `prepare;dur=${(fileStarted - started).toFixed(1)}, file;dur=${(databaseStarted - fileStarted).toFixed(1)}, database;dur=${(performance.now() - databaseStarted).toFixed(1)}` } });
    } else {
      const body = await readApplicationBody(req, 16000);
      if (body.action === "send-code") {
        // A broken sender must not consume the applicant's email resend quota.
        const { sender, transport } = applicationTransport();
        let stage = "resend-limit";
        try {
          await limitRequests("rider:application-email-minute", userId, 1, 60_000);
          await limitRequests("rider:application-email-hour", userId, 6, 3600_000);
          await limitRequests("rider:application-email-budget", "shared", 100, 86400_000);
          const id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, "0");
          stage = "verification-challenge";
          await db.authEmailCode.upsert({ where: { email_purpose: { email: app.user.email, purpose: "RIDER_VERIFY_EMAIL" } }, create: { id, email: app.user.email, purpose: "RIDER_VERIFY_EMAIL", provider: "PASSWORD", subjectId: userId, codeHash: codeHash(id, code), expiresAt: new Date(Date.now() + 600000) }, update: { id, subjectId: userId, codeHash: codeHash(id, code), expiresAt: new Date(Date.now() + 600000), attempts: 0, usedAt: null } });
          stage = "smtp-send";
          const result = await transport.sendMail({ from: { name: "Fetch-It", address: sender }, to: app.user.email, subject: "Verify your Fetch-It rider application email", text: `Your Fetch-It rider verification code is ${code}. It expires in 10 minutes and allows five attempts. Do not share this code.` });
          if (!result.accepted?.length) throw new ApplicationError("Verification email was not accepted.", 503);
        } catch (error) {
          if (!(error instanceof RateLimitError)) console.error("[rider-verification-email] failed", { stage, code: safeErrorCode(error) });
          throw error;
        } finally { transport.close(); }
        return NextResponse.json({ message: "Verification code sent." });
      } else if (body.action === "verify-code") {
        await limitRequests("rider:application-verify", userId, 30, 3600_000);
        if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new ApplicationError("Enter the six-digit code.");
        const code = body.code;
        const correct = await db.$transaction(async tx => {
          const row = await tx.authEmailCode.findUnique({ where: { email_purpose: { email: app.user.email, purpose: "RIDER_VERIFY_EMAIL" } } });
          if (!row) return false;
          await tx.$queryRaw`SELECT "id" FROM "AuthEmailCode" WHERE "id"=${row.id} FOR UPDATE`;
          const fresh = await tx.authEmailCode.findUnique({ where: { id: row.id } });
          if (!fresh || fresh.subjectId !== userId || fresh.usedAt || fresh.attempts >= 5 || fresh.expiresAt <= new Date()) return false;
          const valid = timingSafeEqual(Buffer.from(fresh.codeHash, "hex"), Buffer.from(codeHash(fresh.id, code), "hex"));
          await tx.authEmailCode.update({ where: { id: fresh.id }, data: { attempts: { increment: 1 }, ...(valid ? { usedAt: new Date() } : {}) } });
          if (valid) await tx.riderApplication.update({ where: { id: app.id }, data: { emailVerifiedAt: new Date(), verifiedEmail: app.user.email, version: { increment: 1 } } });
          return valid;
        });
        if (!correct) throw new ApplicationError("Code is incorrect, expired, or already used. Request another code when needed.");
      } else if (body.action === 'remove-document') {
        const saved = await removeApplicationDocument(userId, body.version, body.documentId, app);
        return NextResponse.json({ application: publicApplication(saved) });
      } else if (body.action === 'demo-enable' || body.action === 'demo-reset') await changeApplicationDemoMode(userId, body.version, body.action === 'demo-enable');
      else if (body.action === "save" || body.action === "submit") {
        const saved = await saveApplication(userId, { ...body, submit: body.action === "submit" }, app);
        return NextResponse.json({ application: publicApplication(saved) });
      }
      else throw new ApplicationError("Choose a valid application action.");
    }
    app = await db.riderApplication.findUniqueOrThrow({ where: { id: app.id }, include: applicationDetail });
    return NextResponse.json({ application: publicApplication(app) });
  } catch (error) { return applicationErrorResponse(error); }
}
