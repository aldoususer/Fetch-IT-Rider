import { get } from "@vercel/blob";
import { ApplicationError } from "./rider-application-policy";
export async function readApplicationDocument(applicationId: string, doc: { pathname: string; mimeType: string }) {
  if (!doc.pathname.startsWith(`rider-applications/${applicationId}/`) || !/\/[a-f0-9-]{36}\.(jpg|pdf)$/.test(doc.pathname)) throw new ApplicationError("Document unavailable.", 404);
  const blob = await get(doc.pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new ApplicationError("Document unavailable.", 404);
  return new Response(blob.stream, { headers: { "Content-Type": doc.mimeType, "Content-Disposition": `${doc.mimeType === "application/pdf" ? "attachment" : "inline"}; filename="application-document.${doc.mimeType === "application/pdf" ? "pdf" : "jpg"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
