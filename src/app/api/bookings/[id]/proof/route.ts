// POST /api/bookings/[id]/proof
// Rider submits one or more e-POD artifacts for the booking.
// Body: { signatureSvg?, otp?, photoDataUrl?, recipientName?, notes? }
//  - If `otp` is provided, we mark the OTP proof as verified if it matches.
//  - If `signatureSvg` is provided, we create a SIGNATURE proof row.
//  - If `photoDataUrl` is provided, we create a PHOTO proof row.
// When at least one proof is verified AND the booking is IN_TRANSIT, we
// auto-advance the booking to DELIVERED.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "RIDER") {
      return NextResponse.json(
        { error: "Only riders can submit proof of delivery." },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = (await req.json()) as {
      signatureSvg?: string;
      otp?: string;
      photoDataUrl?: string;
      recipientName?: string;
      notes?: string;
    };

    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.riderId !== session.uid) {
      return NextResponse.json(
        { error: "You are not assigned to this booking." },
        { status: 403 },
      );
    }

    const created: { type: string; verified: boolean }[] = [];

    // 1) OTP verification
    if (body.otp) {
      const otpRow = await db.deliveryProof.findFirst({
        where: { bookingId: id, proofType: "OTP" },
      });
      if (!otpRow || !otpRow.otpCode) {
        return NextResponse.json(
          { error: "No OTP has been issued for this booking." },
          { status: 400 },
        );
      }
      const ok = otpRow.otpCode === body.otp.trim();
      if (ok) {
        await db.deliveryProof.update({
          where: { id: otpRow.id },
          data: { otpVerified: true },
        });
      }
      created.push({ type: "OTP", verified: ok });
      if (!ok) {
        return NextResponse.json(
          { error: "OTP did not match. Please confirm with the recipient." },
          { status: 400 },
        );
      }
    }

    // 2) Signature
    if (body.signatureSvg) {
      const sig = await db.deliveryProof.create({
        data: {
          bookingId: id,
          riderId: session.uid,
          proofType: "SIGNATURE",
          signatureSvg: body.signatureSvg,
          recipientName: body.recipientName ?? null,
          notes: body.notes ?? null,
        },
      });
      created.push({ type: "SIGNATURE", verified: true });
      void sig;
    }

    // 3) Photo (data URL — for demo we keep it in DB, truncated if very large)
    if (body.photoDataUrl) {
      const photo = body.photoDataUrl.slice(0, 200_000); // cap at ~200KB
      const ph = await db.deliveryProof.create({
        data: {
          bookingId: id,
          riderId: session.uid,
          proofType: "PHOTO",
          photoUrl: photo,
          recipientName: body.recipientName ?? null,
          notes: body.notes ?? null,
        },
      });
      created.push({ type: "PHOTO", verified: true });
      void ph;
    }

    if (created.length === 0) {
      return NextResponse.json(
        { error: "No proof artifacts provided." },
        { status: 400 },
      );
    }

    // Auto-advance to DELIVERED when the OTP is verified OR a signature was
    // captured (e-POD is considered complete with signature alone).
    const anyVerified = created.some(
      (p) => p.verified && (p.type === "OTP" || p.type === "SIGNATURE"),
    );
    if (
      anyVerified &&
      ["IN_TRANSIT", "PICKED_UP", "ACCEPTED"].includes(booking.status)
    ) {
      await db.booking.update({
        where: { id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
      await db.user.update({
        where: { id: session.uid },
        data: { totalDeliveries: { increment: 1 } },
      });
    }

    return NextResponse.json({ ok: true, proofs: created });
  } catch (err) {
    console.error("[proof POST] error", err);
    return NextResponse.json(
      { error: "Failed to submit proof of delivery." },
      { status: 500 },
    );
  }
}
