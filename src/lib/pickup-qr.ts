// A QR is another way to enter the existing OTP, never proof of verification.
const PREFIX = "fetchit:pickup:v1:";

export function encodePickupQr(bookingId: string, otp: string, expiresAt: string) {
  return PREFIX + JSON.stringify({ bookingId, otp, expiresAt: Date.parse(expiresAt) });
}

export function readPickupQr(raw: string, bookingId: string, now = Date.now()): { code: string } | { error: string } {
  if (raw.length > 1024 || !raw.startsWith(PREFIX)) return { error: "Scan the pickup QR shown in the passenger’s Fetch-It booking." };
  try {
    const data = JSON.parse(raw.slice(PREFIX.length));
    if (!data || typeof data !== "object" || typeof data.bookingId !== "string" ||
        typeof data.otp !== "string" || !/^\d{6}$/.test(data.otp) ||
        typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) {
      return { error: "This pickup QR is invalid. Ask the passenger to refresh their code." };
    }
    if (data.bookingId !== bookingId) return { error: "This QR belongs to a different booking. Check the passenger’s booking." };
    if (data.expiresAt <= now) return { error: "This pickup QR expired. Ask the passenger to show a new code." };
    return { code: data.otp };
  } catch {
    return { error: "This pickup QR is invalid. Ask the passenger to refresh their code." };
  }
}
