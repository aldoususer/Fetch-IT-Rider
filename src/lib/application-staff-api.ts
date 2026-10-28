import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { applicationDetail, publicApplication, reviewApplication, canReviewApplications, canActivateApplications, type ApplicationActor } from "./rider-application";
import { RateLimitError } from "./request-guard";
import { ApplicationError } from "./rider-application-policy";
import { readApplicationDocument } from "./application-storage";
import { sendApplicationEmail, orientationLetter, applicationMessage } from "./application-mail";

export async function staffApplicationRequest(req: NextRequest, actor: ApplicationActor, id?: string) {
  try {
    if (!canReviewApplications(actor.role)) throw new ApplicationError("Application review access required.", 403);
    if (!id) {
      const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100), status = req.nextUrl.searchParams.get("status"), cursor = req.nextUrl.searchParams.get("cursor"), mode = req.nextUrl.searchParams.get('mode');
      const records = await db.riderApplication.findMany({ where: { ...(['demo', 'real'].includes(mode || '') ? { isDemo: mode === 'demo' } : {}), ...(q ? { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}), ...(status ? { status } : {}) }, select: { id: true, isDemo: true, status: true, vehicleClass: true, services: true, updatedAt: true, assignedToId: true, user: { select: { name: true, email: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 26, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      return NextResponse.json({ applications: records.slice(0, 25), nextCursor: records.length > 25 ? records[24].id : null });
    }
    const body = req.method === "GET" ? null : await readApplicationBody(req, 32000);
    // Mutations validate ownership and version under the application lock. Reuse
    // their committed snapshot instead of loading every relation before and after.
    if (body && body.action !== "preview" && body.action !== "email") {
      let saved = await reviewApplication(id, actor, body);
      const kind = ({ corrections: "CORRECTIONS", schedule: "ORIENTATION", activate: "ACTIVATED", "complete-demo": "ACTIVATED" } as Record<string, string>)[String(body.action)];
      const pending = kind ? saved.emails.find(email => email.kind === kind && email.status === "PENDING") : undefined;
      if (pending) {
        await sendApplicationEmail(pending.id);
        saved = await db.riderApplication.findUniqueOrThrow({ where: { id }, include: applicationDetail });
      }
      const approvals = ["activate", "reopen"].includes(String(body.action))
        ? await db.riderServiceApproval.findMany({ where: { userId: saved.userId } }) : undefined;
      return NextResponse.json({ application: publicApplication(saved, true), ...(approvals ? { approvals } : {}) });
    }
    const app = await db.riderApplication.findUnique({ where: { id }, include: applicationDetail });
    if (!app) throw new ApplicationError("Application unavailable.", 404);
    if (!canActivateApplications(actor.role) && app.assignedToId && app.assignedToId !== actor.id) throw new ApplicationError("This application belongs to another reviewer.", 403);
    if (req.method === "GET") {
      const docId = req.nextUrl.searchParams.get("document");
      if (docId) {
        if (!canActivateApplications(actor.role) && app.assignedToId !== actor.id) throw new ApplicationError("Claim the application before opening documents.", 403);
        const doc = app.documents.find(d => d.id === docId); if (!doc) throw new ApplicationError("Document not found.", 404);
        return readApplicationDocument(app.id, doc);
      }
      if (req.nextUrl.searchParams.has("letter")) {
        if (!app.orientationAt || !["ORIENTATION_SCHEDULED", "ASSESSED", "ACTIVE", "DEMO_COMPLETED"].includes(app.status)) throw new ApplicationError("There is no current orientation invitation.", 404);
        const email = await db.riderApplicationEmail.findFirst({ where: { applicationId: app.id, kind: "ORIENTATION" }, orderBy: { createdAt: "desc" } });
        if (!email) throw new ApplicationError("No invitation has been scheduled.", 404);
        return pdfResponse(await orientationLetter(email.payload as never));
      }
      const approvals = await db.riderServiceApproval.findMany({ where: { userId: app.userId } });
      return NextResponse.json({ application: publicApplication(app, true), approvals, actor: { id: actor.id, canActivate: canActivateApplications(actor.role) } });
    }
    if (!body) throw new ApplicationError("Request details are required.");
    if (body.action === "preview") {
      if (!canActivateApplications(actor.role)) throw new ApplicationError("Admin access required.", 403);
      const at = new Date(String(body.orientationAt));
      if (!Number.isFinite(at.getTime()) || typeof body.venue !== "string" || body.venue.length > 2000 || typeof body.instructions !== "string" || body.instructions.length > 2000) throw new ApplicationError("Complete the schedule details.");
      const p = { name: (app.fields as Record<string, string>).legalName, applicationId: app.id, vehicle: app.vehicleClass, services: app.services.join(" / "), date: at.toISOString(), venue: body.venue, instructions: body.instructions, demo: app.isDemo };
      return body.pdf ? pdfResponse(await orientationLetter(p)) : NextResponse.json(applicationMessage("ORIENTATION", p));
    }
    if (body.action === "email") {
      if (!canActivateApplications(actor.role)) throw new ApplicationError("Admin access required.", 403);
      const email = app.emails.find(e => e.id === body.emailId);
      if (!email) throw new ApplicationError("Email not found.", 404);
      if (email.id !== app.emails.find(e => e.kind === email.kind)?.id || !({ CORRECTIONS: ["NEEDS_CORRECTION"], ORIENTATION: ["ORIENTATION_SCHEDULED", "ASSESSED", "ACTIVE", "DEMO_COMPLETED"], ACTIVATED: ["ACTIVE", "DEMO_COMPLETED"] } as Record<string, string[]>)[email.kind]?.includes(app.status)) throw new ApplicationError("This message has been superseded by the current application status or schedule.", 409);
      if (email.status === "SENT") throw new ApplicationError("This invitation has already been sent.", 409);
      if (email.status === "UNCERTAIN" || (email.status === "SENDING" && email.startedAt && email.startedAt < new Date(Date.now() - 120000))) {
        if (body.confirmResend !== true) throw new ApplicationError("Check the recipient mailbox first, then explicitly confirm resending; the earlier message may have been delivered.", 409);
        await db.riderApplicationEmail.updateMany({ where: { id: email.id, status: email.status }, data: { status: "FAILED" } });
      }
      await sendApplicationEmail(email.id);
    }
    return NextResponse.json({ application: publicApplication(await db.riderApplication.findUniqueOrThrow({ where: { id }, include: applicationDetail }), true) });
  } catch (error) { return applicationErrorResponse(error); }
}
export function pdfResponse(bytes: Buffer) { return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Fetch-It-Orientation-Letter.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
export function applicationErrorResponse(error: unknown) { if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "private, no-store" } }); return NextResponse.json({ error: error instanceof ApplicationError ? error.message : "Application service unavailable. Your saved work is preserved; please retry." }, { status: error instanceof ApplicationError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }); }

// Bound chunked JSON too; Content-Length is optional and cannot be trusted.
export async function readApplicationBody(req: Request, limit: number): Promise<Record<string, unknown>> {
  if (+(req.headers.get("content-length") ?? 0) > limit) throw new ApplicationError("Request too large.", 413);
  const reader = req.body?.getReader(); if (!reader) throw new ApplicationError("Request details are required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > limit) { await reader.cancel(); throw new ApplicationError("Request too large.", 413); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid object");
    return body;
  } catch { throw new ApplicationError("Enter valid request details."); }
}
