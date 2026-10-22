import { put, del } from "@vercel/blob";
import sharp from "sharp";
import { EPOD_MAX_DATA_URL_LENGTH, EPOD_MAX_PHOTO_BYTES } from "./epod-photo";
import { RiderError } from "./rider-access";

export async function uploadDeliveryPhoto(bookingId: string, proofId: string, dataUrl: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(bookingId) || !/^[a-f0-9-]{36}$/.test(proofId)) throw new RiderError("Invalid photo reference.", 400);
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || dataUrl.length > EPOD_MAX_DATA_URL_LENGTH) throw new RiderError("Choose a JPEG, PNG or WebP photo.", 400);
  const input = Buffer.from(match[2], "base64");
  let photo: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported image");
    // Re-encode real image bytes, normalize phone orientation and remove metadata.
    photo = await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).flatten({ background: "#fff" }).jpeg({ quality: 75 }).toBuffer();
    if (photo.length > EPOD_MAX_PHOTO_BYTES) {
      photo = await sharp(photo).resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
    }
    if (photo.length > EPOD_MAX_PHOTO_BYTES) throw new Error("Image too large");
  } catch { throw new RiderError("This photo could not be processed. Choose a smaller JPEG, PNG or WebP image.", 400); }
  try {
    const blob = await put(`epods/${bookingId}/${proofId}.jpg`, photo, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: false });
    return blob.pathname;
  } catch { throw new RiderError("Photo storage is unavailable. Your proof was not saved. Please try again.", 503); }
}

export async function removeUncommittedPhoto(pathname: string) {
  try { await del(pathname); }
  catch { console.error(JSON.stringify({ operation: "epod:cleanup", code: "BLOB_DELETE_FAILED" })); }
}
