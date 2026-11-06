"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readPickupQr } from "@/lib/pickup-qr";
import { startPickupCamera } from "@/lib/pickup-qr-camera";

export function PickupQrScanner({ bookingId, disabled, onScan }: {
  bookingId: string; disabled: boolean; onScan: (code: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scanCallback = useRef(onScan);
  useEffect(() => { scanCallback.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!active || disabled || !video.current) return;
    return startPickupCamera(video.current, {
      onReady: () => setMessage("Point your camera at the passenger’s pickup QR."),
      onRead: text => {
        const result = readPickupQr(text, bookingId);
        if ("error" in result) { setError(result.error); return false; }
        scanCallback.current(result.code);
        setActive(false);
        setError(null);
        setMessage("Pickup code scanned. Verify the code below to confirm boarding.");
        return true;
      },
      onError: text => { setActive(false); setMessage(""); setError(text); },
    });
  }, [active, disabled, bookingId]);

  return (
    <div className="space-y-3">
      {active && !disabled ? <>
        <video ref={video} muted playsInline autoPlay aria-label="Pickup QR camera preview"
          className="aspect-square max-h-72 w-full rounded-xl bg-black object-contain" />
        <Button type="button" variant="outline" className="min-h-12 w-full" onClick={() => { setActive(false); setMessage(""); setError(null); }}>Stop scanning · Enter code instead</Button>
      </> : <Button type="button" variant="outline" className="min-h-12 w-full" disabled={disabled}
        onClick={() => { setError(null); setMessage("Opening camera… Allow camera access when asked."); setActive(true); }}>
        <ScanLine className="h-4 w-4" aria-hidden="true" /> Scan pickup QR
      </Button>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
