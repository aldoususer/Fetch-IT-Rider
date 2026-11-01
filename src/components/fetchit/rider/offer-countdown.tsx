'use client';
import { useEffect, useState } from 'react';
export function OfferCountdown({ expiresAt }: { expiresAt?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return <span className="rd-offer-time" role="timer" aria-label={seconds ? `Offer expires in ${seconds} seconds` : 'Offer expired'}>{seconds ? `Offer expires in ${seconds}s` : 'Offer expired · refresh jobs'}</span>;
}
