// Public reference helpers only. Storage credentials never belong in this module.
export const EPOD_MAX_PHOTO_BYTES = 250 * 1024;
export const EPOD_MAX_DATA_URL_LENGTH = 700_000;

export function deliveryPhotoUrl(bookingId: string, proofId: string) {
  return `/api/bookings/${encodeURIComponent(bookingId)}/proof/${encodeURIComponent(proofId)}/photo`;
}

export function isDeliveryPhotoPath(path: string, bookingId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(bookingId)) return false;
  return path.startsWith(`epods/${bookingId}/`) && /^[a-f0-9-]{36}\.jpg$/.test(path.slice(`epods/${bookingId}/`.length));
}
