"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { setRiderPushAccount } from "@/lib/rider-push";
import { LandingView } from "@/components/fetchit/shared/landing";
import { AuthView } from "@/components/fetchit/shared/auth-view";
import { RiderApplicationBoundary } from "@/components/fetchit/rider/rider-application";

export default function Home() {
  const { view, bootstrapped, bootstrap, startup, user } = useAppStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (bootstrapped) void setRiderPushAccount(user?.id ?? null).catch(() => {});
    const message = (event: MessageEvent) => {
      if (event.data?.type === 'FETCHIT_RIDER_PUSH' && event.data.riderId === useAppStore.getState().user?.id) window.dispatchEvent(new Event('fetchit:rider-push'));
    };
    navigator.serviceWorker?.addEventListener('message', message);
    return () => navigator.serviceWorker?.removeEventListener('message', message);
  }, [bootstrapped, user?.id]);

  useEffect(() => {
    const refresh = () => {
      const state = useAppStore.getState();
      if (state.bootstrapped) void state.refreshUser();
      else void state.bootstrap();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!bootstrapped) {
    if (startup === "unavailable") return (
      <main className="grid min-h-dvh place-items-center bg-white p-6 text-center text-[#173c32]">
        <div className="max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">Can’t connect to Fetch-It</h1>
          <p className="text-base text-[#4d6358]">Check your internet connection and try again to open your rider workspace.</p>
          <button type="button" className="min-h-12 rounded-xl bg-primary px-6 font-medium text-primary-foreground" onClick={() => void bootstrap()}>Try again</button>
        </div>
      </main>
    );
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <svg
            width="48"
            height="48"
            viewBox="0 0 64 64"
            className="animate-fit-pulse"
            aria-hidden
          >
            <rect width="64" height="64" rx="14" fill="var(--primary)" />
            <path
              d="M16 22 L32 14 L48 22 L48 42 L32 50 L16 42 Z"
              fill="var(--primary-foreground)"
              opacity="0.95"
            />
          </svg>
          <p className="text-sm" role="status">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (view === "landing") return <LandingView />;
  if (view === "login") return <AuthView initialMode="login" />;
  if (view === "signup") return <AuthView initialMode="signup" />;
  if (view === "rider-dashboard") return <RiderApplicationBoundary key={user?.id} />;
  return <LandingView />;
}
