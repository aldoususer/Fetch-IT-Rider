"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Fix = { lat: number; lng: number; accuracy: number; at: number; speedKph?: number; heading?: number };

export function BrowserLocation({ userId, needed, availabilityKnown = true }: { userId: string; needed: boolean; availabilityKnown?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(0);
  const latest = useRef<Fix | null>(null);
  useEffect(() => {
    if (!enabled || !needed) return;
    if (!window.isSecureContext || !navigator.geolocation) return;
    const controller = new AbortController();
    let busy = false;
    let lastSentFix = 0;
    let lastAttempt = 0;
    latest.current = null;
    async function publish() {
      const point = latest.current;
      if (busy || document.hidden || !navigator.onLine || !point || Date.now() - point.at > 30_000 || point.at <= lastSentFix || Date.now() - lastAttempt < 5000) return;
      busy = true; lastAttempt = Date.now();
      try {
        const response = await fetch("/api/rider/location", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...point, capturedAt: point.at }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn’t share location. Retrying…");
        if (!controller.signal.aborted) { lastSentFix = point.at; setSentAt(Date.now()); setError(""); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t share location. Retrying…"); }
      finally { busy = false; }
    }
    const capture = (position: GeolocationPosition) => {
      if (controller.signal.aborted) return;
      const coords = position.coords;
      if (![coords.latitude, coords.longitude, coords.accuracy].every(Number.isFinite) || Date.now() - position.timestamp > 30_000) return;
      const point: Fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: position.timestamp,
        ...(coords.speed != null && coords.speed >= 0 ? { speedKph: coords.speed * 3.6 } : {}),
        ...(coords.heading != null && Number.isFinite(coords.heading) ? { heading: coords.heading } : {}) };
      latest.current = point; setFix(point); void publish();
    };
    const onError = (failure: GeolocationPositionError) => {
      if (controller.signal.aborted) return;
      latest.current = null; setFix(null); setSentAt(null);
      setError(failure.code === 1 ? "Location permission denied. Allow location in your browser’s site settings, then retry." : failure.code === 2 ? "Your device could not determine its location. Turn on location services and retry." : "Location timed out. Move near a window or outdoors and retry.");
    };
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
    const watch = navigator.geolocation.watchPosition(capture, onError, options);
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden && navigator.onLine) navigator.geolocation.getCurrentPosition(capture, onError, options);
    }, 10000);
    const resume = () => { setNow(Date.now()); void publish(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { controller.abort(); navigator.geolocation.clearWatch(watch); clearInterval(timer); latest.current = null;
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [enabled, needed, retry, userId]);
  const fresh = needed && enabled && fix && Math.max(now, Date.now()) - fix.at <= 30_000;
  return <details className="rd-location" aria-label="Browser location sharing">
    <summary><span className={fresh && sentAt ? 'rd-gps-dot is-sharing' : 'rd-gps-dot'} aria-hidden="true"/><strong>{!availabilityKnown ? 'Checking location status…' : error ? 'GPS needs attention' : !needed ? 'GPS inactive' : !enabled ? 'GPS off · location not shared' : fresh && sentAt ? 'GPS shared with your customer' : 'Finding your location…'}</strong><span className="rd-location-expand">Details</span></summary>
    <div className="rd-location-body space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Your live location</h2><p className="text-xs text-muted-foreground">Shared with your assigned customer during an active booking.</p></div><Button size="sm" variant={enabled ? "outline" : "default"} disabled={!needed} onClick={() => {
      if (!window.isSecureContext || !navigator.geolocation) { setError("Location sharing needs HTTPS and a browser that supports location."); return; }
      setEnabled(value => !value); setError(""); setFix(null); setSentAt(null);
    }}>{enabled ? "Stop sharing" : "Share location"}</Button></div>
    <p className="text-sm" role="status">{!availabilityKnown ? 'Checking your availability before enabling location sharing.' : !needed ? "Go online to share your location." : error || (!enabled ? "Receiving jobs and sharing GPS are separate. Enable location so your assigned customer can follow your progress." : (!fix ? "Finding your location…" : !fresh ? "Location is stale. Waiting for a fresh device location…" : sentAt ? "Location shared" : "Sharing location…"))}</p>
    {fresh && <div className="text-sm space-y-1"><a className="underline underline-offset-4" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${fix.lat}&mlon=${fix.lng}#map=17/${fix.lat}/${fix.lng}`}>{fix.lat.toFixed(6)}, {fix.lng.toFixed(6)} · View on map</a><p className="text-xs text-muted-foreground">Device accuracy: ±{Math.round(fix.accuracy)} m{fix.accuracy > 100 ? " · Approximate location; move outdoors for better accuracy." : ""}</p>{sentAt && <p className="text-xs text-muted-foreground">Last shared {new Date(sentAt).toLocaleTimeString()}</p>}</div>}
    {enabled && error && <Button size="sm" variant="outline" onClick={() => { setError(""); setFix(null); setSentAt(null); setRetry(value => value + 1); }}>Retry location</Button>}
    <p className="text-xs text-muted-foreground">Keep this page open and your device awake while sharing. Your browser may pause GPS when it is in the background.</p>
    </div>
  </details>;
}
