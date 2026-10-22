import { withRequestLog, RateLimitError, limitRequests } from "@/lib/request-guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recordBookingEvent } from "@/lib/booking-events";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";
import { settleDemoEarnings } from "@/lib/demo-payments";
import { isDemoPayment } from "@/lib/payment-policy";
import { randomUUID } from "node:crypto";
import { EPOD_MAX_DATA_URL_LENGTH } from "@/lib/epod-photo";
import { uploadDeliveryPhoto, removeUncommittedPhoto } from "@/lib/epod-upload";

export const runtime = "nodejs";

async function readProofBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new RiderError("Proof details are required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 820_000) { await reader.cancel(); throw new RiderError("Proof photo is too large.", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new RiderError("Provide valid proof details.", 400); }
  } finally { reader.releaseLock(); }
}

function checkBooking(booking: { riderId: string | null; type: string; status: string; paymentMethod: string; paymentStatus: string } | null, riderId: string) {
  if (!booking) throw new RiderError("Booking not found.", 404);
  if (booking.riderId !== riderId) throw new RiderError("You are not assigned to this booking.", 403);
  if (isDemoPayment(booking.paymentMethod) && booking.paymentStatus !== "PAID") throw new RiderError("Demo payment must succeed before delivery.", 409);
  if (booking.type !== "DELIVERY" || booking.status !== "IN_TRANSIT") throw new RiderError("Proof can only be submitted for a delivery in transit.", 409);
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let uploadedPath: string | undefined;
  let photoProofId: string | undefined;
  try {
    const session = await requireRider(await getSession());
    const origin = req.headers.get("origin");
    if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") throw new RiderError("This request is not allowed.", 403);
    await limitRequests("rider:proof", session.uid, 20, 5 * 60_000);
    const { id } = await params;
    const body = await readProofBody(req);
    if (body?.otp !== undefined) throw new RiderError("OTP is used for ride pickup. Use a recipient signature for delivery completion.", 400);
    if (!body ||
        (body.signatureSvg !== undefined && (typeof body.signatureSvg !== "string" || body.signatureSvg.length > 100_000)) ||
        (body.photoDataUrl !== undefined && (typeof body.photoDataUrl !== "string" || body.photoDataUrl.length > EPOD_MAX_DATA_URL_LENGTH || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.photoDataUrl))) ||
        (body.recipientName !== undefined && (typeof body.recipientName !== "string" || body.recipientName.length > 100)) ||
        (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000)))
      throw new RiderError("Provide a valid recipient signature or small delivery photo.", 400);
    if (!body.signatureSvg && !body.photoDataUrl) throw new RiderError("No proof artifacts provided.", 400);
    // Check access before decoding an image or spending a Blob upload operation.
    checkBooking(await db.booking.findUnique({ where: { id } }), session.uid);
    if (body.photoDataUrl) {
      if (await db.deliveryProof.count({ where: { bookingId: id, proofType: "PHOTO" } }) >= 3) throw new RiderError("This delivery already has three supporting photos.", 409);
      photoProofId = randomUUID();
      uploadedPath = await uploadDeliveryPhoto(id, photoProofId, body.photoDataUrl);
    }
    const result = await db.$transaction(async tx => {
      // Serialize proof submission, completion, and cancellation.
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id } });
      checkBooking(booking, session.uid);
      if (uploadedPath && await tx.deliveryProof.count({ where: { bookingId: id, proofType: "PHOTO" } }) >= 3) throw new RiderError("This delivery already has three supporting photos.", 409);
      const now = new Date();
      const proofs: { type: string; verified: boolean }[] = [];
      if (body.signatureSvg) {
        await tx.deliveryProof.create({ data: { bookingId: id, riderId: session.uid, proofType: "SIGNATURE",
          signatureSvg: body.signatureSvg, recipientName: body.recipientName ?? null, notes: body.notes ?? null, verifiedAt: now } });
        proofs.push({ type: "SIGNATURE", verified: true });
      }
      if (uploadedPath) {
        await tx.deliveryProof.create({ data: { id: photoProofId, bookingId: id, riderId: session.uid, proofType: "PHOTO",
          photoUrl: uploadedPath, recipientName: body.recipientName ?? null, notes: body.notes ?? null } });
        proofs.push({ type: "PHOTO", verified: false });
      }
      if (proofs.some(p => p.verified)) {
        const completed = await tx.booking.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: now } });
        await settleDemoEarnings(tx, completed);
        await tx.riderProfile.update({ where: { userId: session.uid }, data: { totalDeliveries: { increment: 1 } } });
        await recordBookingEvent(tx, id, session, { action: "STATUS_CHANGED", fromStatus: "IN_TRANSIT", toStatus: "DELIVERED", riderId: session.uid });
      }
      return { proofs };
    });
    return NextResponse.json({ ok: true, proofs: result.proofs });
  } catch (error) {
    if (uploadedPath && photoProofId) {
      // A lost commit acknowledgement must never delete a committed proof photo.
      try {
        const saved = await db.deliveryProof.findUnique({ where: { id: photoProofId }, select: { id: true } });
        if (!saved) await removeUncommittedPhoto(uploadedPath);
      } catch { console.error(JSON.stringify({ operation: "epod:cleanup", code: "COMMIT_STATE_UNKNOWN" })); }
    }
    if (error instanceof RateLimitError) throw error; return riderErrorResponse(error); }
}

export const POST = withRequestLog("rider:bookings/[id]/proof:POST", handlePOST);
