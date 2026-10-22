import { get } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { isDeliveryPhotoPath } from "./epod-photo";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };

// Callers must authenticate first and supply their allowed booking scope.
export async function deliveryPhotoResponse(bookingId: string, proofId: string, scope: Prisma.BookingWhereInput) {
  const proof = await db.deliveryProof.findFirst({
    where: { id: proofId, bookingId, proofType: "PHOTO", booking: scope },
    select: { photoUrl: true },
  });
  const reference = proof?.photoUrl;
  if (!reference) return new Response("Photo not found.", { status: 404, headers });

  // Keep historical inline photos readable without fetching arbitrary URLs.
  const inline = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(reference);
  if (inline && reference.length <= 200_000) {
    return new Response(Buffer.from(inline[2], "base64"), { headers: { ...headers, "Content-Type": `image/${inline[1]}` } });
  }
  if (!isDeliveryPhotoPath(reference, bookingId)) return new Response("Photo not found.", { status: 404, headers });
  const result = await get(reference, { access: "private" });
  if (!result || result.statusCode !== 200) return new Response("Photo not found.", { status: 404, headers });
  return new Response(result.stream, { headers: { ...headers, "Content-Type": "image/jpeg" } });
}
