'use client';
export type RiderFix = { lat: number; lng: number; accuracy: number; capturedAt: number };
// Per-page memory only. Never persist precise location or reuse another account's fix.
let recent: { userId: string; fix: RiderFix } | null = null;
function usable(fix: RiderFix, maximumAge = 15000) {
  return [fix.lat, fix.lng, fix.accuracy, fix.capturedAt].every(Number.isFinite) && Math.abs(fix.lat) <= 90 && Math.abs(fix.lng) <= 180 && fix.accuracy >= 0 && fix.accuracy <= 100 && Date.now() - fix.capturedAt <= maximumAge && fix.capturedAt <= Date.now() + 5000;
}
export function rememberRiderLocation(userId: string, fix: RiderFix) {
  if (usable(fix, 30000) && (!recent || recent.userId !== userId || fix.capturedAt >= recent.fix.capturedAt)) recent = { userId, fix: { ...fix } };
}
export function clearRiderLocation(userId: string) { if (recent?.userId === userId) recent = null; }
export function captureRiderLocation(maximumAge = 0): Promise<RiderFix> {
  if (!window.isSecureContext || !navigator.geolocation) return Promise.reject(new Error('Location sharing needs HTTPS and a supported browser.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: position.timestamp };
      if (!usable(fix, 30000)) return reject(new Error('Location is too approximate. Move outdoors and retry.'));
      resolve(fix);
    }, error => reject(new Error(error.code === 1 ? 'Location permission is blocked. Allow location in this site’s browser settings, then retry.' : error.code === 2 ? 'Turn on your phone’s location service, then retry.' : 'Location timed out. Move near a window or outdoors and retry.')),
    { enableHighAccuracy: true, maximumAge, timeout: 15000 });
  });
}
export async function acceptanceLocation(userId: string): Promise<RiderFix> {
  // Permission can be revoked after the last watch callback. Respect that change.
  let granted = false;
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' });
    if (permission?.state === 'denied') { clearRiderLocation(userId); throw new Error('Location permission is blocked. Allow location in your browser’s site settings, then retry.'); }
    granted = permission?.state === 'granted';
  } catch (failure) {
    if (failure instanceof Error && failure.message.startsWith('Location permission is blocked')) throw failure;
    // Browsers without Permissions API still enforce permission in getCurrentPosition.
  }
  if (granted && recent?.userId === userId && usable(recent.fix)) return { ...recent.fix };
  const fix = await captureRiderLocation(15000);
  if (!usable(fix)) throw new Error('Your location is out of date. Refresh location and try again.');
  rememberRiderLocation(userId, fix);
  return fix;
}
