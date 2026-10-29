"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RiderProfileDetails, type RiderProfileData } from '../shared/rider-profile';

export function RiderAccountProfile({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [profile, setProfile] = useState<RiderProfileData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setProfile(null); setError('');
      void (async () => {
        try {
          const response = await fetch('/api/rider/profile', { cache: 'no-store', signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !data.profile) throw new Error(data.error || 'Could not load your rider profile.');
          if (!controller.signal.aborted) setProfile(data.profile);
        } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load your rider profile.'); }
      })();
    });
    return () => controller.abort();
  }, [open, attempt]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Rider profile</DialogTitle><DialogDescription>Your vehicle, approved services and customer ratings.</DialogDescription></DialogHeader>{profile ? <RiderProfileDetails profile={profile}/> : error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div> : <p role="status" className="text-sm text-muted-foreground">Loading your rider profile…</p>}</DialogContent></Dialog>;
}
