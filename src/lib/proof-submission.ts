import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { validTimingId } from './booking-telemetry';

type Artifacts = { signatureSvg?: string; photoDataUrl?: string; recipientName?: string; notes?: string };
export function proofSubmission(bookingId: string, riderId: string, suppliedKey: string | null, body: Artifacts) {
  if (suppliedKey !== null && !validTimingId(suppliedKey)) throw new Error('INVALID_PROOF_KEY');
  const key = suppliedKey ?? randomUUID();
  // Bind retries to the same actor, booking, and exact artifact payload. Only
  // opaque UUIDs are stored; photos, names and notes never enter telemetry.
  const payload = JSON.stringify([bookingId, riderId, key, body.signatureSvg ?? null, body.photoDataUrl ?? null, body.recipientName ?? null, body.notes ?? null]);
  const id = (kind: string) => {
    const hex = createHash('sha256').update(kind + payload).digest('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  };
  return { signatureId: id('SIGNATURE'), photoId: id('PHOTO'), hasSignature: !!body.signatureSvg, hasPhoto: !!body.photoDataUrl };
}
export async function savedProofResult(db: Pick<PrismaClient | Prisma.TransactionClient, 'deliveryProof'>, bookingId: string, riderId: string, attempt: ReturnType<typeof proofSubmission>) {
  const ids = [...(attempt.hasSignature ? [attempt.signatureId] : []), ...(attempt.hasPhoto ? [attempt.photoId] : [])];
  const saved = await db.deliveryProof.findMany({ where: { id: { in: ids }, bookingId, riderId }, select: { id: true, proofType: true, verifiedAt: true } });
  if (!ids.length || saved.length !== ids.length || (attempt.hasSignature && !saved.some(p => p.id === attempt.signatureId && p.verifiedAt))) return null;
  return { proofs: saved.map(p => ({ type: p.proofType, verified: !!p.verifiedAt })) };
}
