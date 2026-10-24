import { put, del } from "@vercel/blob";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "./rider-application-policy";
const MAX_BYTES = 3 * 1024 * 1024;
export async function storeApplicationDocument(applicationId: string, kind: string, input: Buffer) {
  if (!input.length || input.length > MAX_BYTES) throw new ApplicationError("Choose a document up to 3 MB.", 413);
  let bytes: Buffer, mime: string, extension: string;
  try {
    if (input.subarray(0, 5).toString() === "%PDF-") {
      const pdf = await PDFDocument.load(input);
      if (pdf.getPageCount() < 1 || pdf.getPageCount() > 10 || /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(input.toString("latin1"))) throw new Error("Unsupported PDF");
      bytes = input; mime = "application/pdf"; extension = "pdf";
    } else {
      const image = sharp(input, { limitInputPixels: 30_000_000, failOn: "warning" });
      const meta = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || Math.min(meta.width, meta.height) < 200) throw new Error("Unsupported image");
      bytes = await image.rotate().resize({ width: 2600, height: 2600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#fff" }).jpeg({ quality: 92 }).toBuffer();
      if (bytes.length > MAX_BYTES) throw new Error("Too large");
      mime = "image/jpeg"; extension = "jpg";
    }
  } catch { throw new ApplicationError("Choose a readable JPEG, PNG, WebP, or unencrypted PDF of 1–10 pages."); }
  if (kind === "PROFILE" && mime !== "image/jpeg") throw new ApplicationError("The profile photo must be an image.");
  const pathname = `rider-applications/${applicationId}/${randomUUID()}.${extension}`;
  await put(pathname, bytes, { access: "private", contentType: mime, addRandomSuffix: false, allowOverwrite: false });
  return { pathname, mimeType: mime };
}

export async function removeUnusedApplicationDocument(pathname: string) { await del(pathname); }
