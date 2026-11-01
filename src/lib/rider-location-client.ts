'use client';
export type RiderFix = { lat: number; lng: number; accuracy: number; capturedAt: number };
export function captureRiderLocation(): Promise<RiderFix> {
  if (!window.isSecureContext || !navigator.geolocation) return Promise.reject(new Error('Location sharing needs HTTPS and a supported browser.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: position.timestamp };
      if (![fix.lat, fix.lng, fix.accuracy, fix.capturedAt].every(Number.isFinite) || fix.accuracy < 0 || fix.accuracy > 100 || Date.now() - fix.capturedAt > 30_000 || fix.capturedAt > Date.now() + 5000) return reject(new Error('Location is too approximate. Move outdoors and retry.'));
      resolve(fix);
    }, error => reject(new Error(error.code === 1 ? 'Location permission is blocked. Allow location in this site’s browser settings, then retry.' : error.code === 2 ? 'Turn on your phone’s location service, then retry.' : 'Location timed out. Move near a window or outdoors and retry.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  });
}
export async function refreshRiderLocation() {
  const fix = await captureRiderLocation();
  const response = await fetch('/api/rider/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fix), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Couldn’t refresh your location. Reconnect and retry.');
  window.dispatchEvent(new CustomEvent('fetchit:rider-location', { detail: { ...fix, at: fix.capturedAt } }));
  return fix;
}
