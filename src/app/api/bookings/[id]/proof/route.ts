import { withRequestLog, RateLimitError, limitRequests } from "@/lib/request-guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { matchesChallenge } from "@/lib/delivery-challenge";
import { recordBookingEvent } from "@/lib/booking-events";
import { requireRider, RiderError, riderErrorResponse } from "@/lib/rider-access";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRider(await getSession());
    await limitRequests("rider:proof", session.uid, 20, 5 * 60_000);
    const { id } = await params;
    const body = await req.json();
    if (!body || (body.otp !== undefined && (typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp.trim()))) ||
        (body.signatureSvg !== undefined && (typeof body.signatureSvg !== "string" || body.signatureSvg.length > 100_000)) ||
        (body.photoDataUrl !== undefined && (typeof body.photoDataUrl !== "string" || body.photoDataUrl.length > 200_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.photoDataUrl))) ||
        (body.recipientName !== undefined && (typeof body.recipientName !== "string" || body.recipientName.length > 100)) ||
        (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000)))
      throw new RiderError("Provide a valid code, signature, or small delivery photo.", 400);
    if (!body.otp && !body.signatureSvg && !body.photoDataUrl) throw new RiderError("No proof artifacts provided.", 400);
    const result = await db.$transaction(async tx => {
      // Serialize proof submission, failed attempts, completion, and cancellation.
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking) throw new RiderError("Booking not found.", 404);
      if (booking.riderId !== session.uid) throw new RiderError("You are not assigned to this booking.", 403);
      if (booking.type !== "DELIVERY" || booking.status !== "IN_TRANSIT")
        throw new RiderError("Proof can only be submitted for a delivery in transit.", 409);
      const now = new Date();
      const proofs: { type: string; verified: boolean }[] = [];
      if (body.otp) {
        const challenge = await tx.deliveryChallenge.findUnique({ where: { bookingId: id } });
        if (!challenge || challenge.expiresAt <= now) return { error: "Request a new delivery code from the customer.", status: 400 };
        if (challenge.verifiedAt) return { error: "This code has already been used.", status: 409 };
        if (challenge.attempts >= challenge.maxAttempts) return { error: "Too many incorrect code attempts.", status: 429 };
        const ok = matchesChallenge(id, body.otp.trim(), challenge.codeHash);
        await tx.deliveryChallenge.update({ where: { bookingId: id },
          data: { attempts: { increment: 1 }, ...(ok ? { verifiedAt: now } : {}) } });
        // Return instead of throwing so a failed attempt is committed.
        if (!ok) return { error: "OTP did not match. Confirm with the recipient.", status: 400 };
        await tx.deliveryProof.create({ data: { bookingId: id, riderId: session.uid, proofType: "OTP", verifiedAt: now } });
        proofs.push({ type: "OTP", verified: true });
      }
      if (body.signatureSvg) {
        await tx.deliveryProof.create({ data: { bookingId: id, riderId: session.uid, proofType: "SIGNATURE",
          signatureSvg: body.signatureSvg, recipientName: body.recipientName ?? null, notes: body.notes ?? null, verifiedAt: now } });
        proofs.push({ type: "SIGNATURE", verified: true });
      }
      // Temporary bounded inline storage until an external file service is selected.
      if (body.photoDataUrl) {
        await tx.deliveryProof.create({ data: { bookingId: id, riderId: session.uid, proofType: "PHOTO",
          photoUrl: body.photoDataUrl, recipientName: body.recipientName ?? null, notes: body.notes ?? null } });
        proofs.push({ type: "PHOTO", verified: false });
      }
      if (proofs.some(p => p.verified)) {
        await tx.booking.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: now } });
        await tx.riderProfile.update({ where: { userId: session.uid }, data: { totalDeliveries: { increment: 1 } } });
        await recordBookingEvent(tx, id, session, { action: "STATUS_CHANGED", fromStatus: "IN_TRANSIT", toStatus: "DELIVERED", riderId: session.uid });
      }
      return { proofs };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, proofs: result.proofs });
  } catch (error) {
    if (error instanceof RateLimitError) throw error; return riderErrorResponse(error); }
}

export const POST = withRequestLog("rider:bookings/[id]/proof:POST", handlePOST);
