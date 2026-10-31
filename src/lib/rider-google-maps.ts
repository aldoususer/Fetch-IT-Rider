import type { GoogleSDK } from './rider-map-renderer';
declare global {
  interface Window {
    google?: { maps: GoogleSDK };
    gm_authFailure?: () => void;
    __fetchitRiderGoogleReady?: () => void;
  }
}
let pending: Promise<GoogleSDK> | undefined;
let fatal = false;
let authHooked = false;
export const GOOGLE_MAP_FAILURE = 'fetchit:google-map-failure';
export function loadRiderGoogleMaps(key: string): Promise<GoogleSDK> {
  if (fatal) return Promise.reject(new Error('Google Maps is unavailable.'));
  if (window.google?.maps?.Map && window.google.maps.Marker) return Promise.resolve(window.google.maps);
  if (pending) return pending;
  if (!authHooked) {
    authHooked = true;
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => { fatal = true; window.dispatchEvent(new Event(GOOGLE_MAP_FAILURE)); previous?.(); };
  }
  pending = new Promise<GoogleSDK>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); window.removeEventListener(GOOGLE_MAP_FAILURE, fail);
      if (error) { script.remove(); reject(error); } else resolve(window.google!.maps);
    };
    const fail = () => finish(new Error('Google Maps is unavailable.'));
    const timer = setTimeout(fail, 12_000);
    window.addEventListener(GOOGLE_MAP_FAILURE, fail);
    window.__fetchitRiderGoogleReady = () => window.google?.maps?.Map && window.google.maps.Marker ? finish() : fail();
    // No Places, Google Routes, Street View or Navigation SDK requests.
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&v=weekly&callback=__fetchitRiderGoogleReady';
    script.async = true; script.onerror = fail; document.head.appendChild(script);
  });
  const shared = pending.catch(error => { if (pending === shared) pending = undefined; throw error; });
  pending = shared;
  return shared;
}
