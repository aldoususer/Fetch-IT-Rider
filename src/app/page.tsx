"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { LandingView } from "@/components/fetchit/shared/landing";
import { AuthView } from "@/components/fetchit/shared/auth-view";
import { RiderDashboard } from "@/components/fetchit/rider/rider-dashboard";

export default function Home() {
  const { view, bootstrapped, bootstrap } = useAppStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!bootstrapped) {
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
          <p className="text-sm">Loading Fetch-It…</p>
        </div>
      </div>
    );
  }

  if (view === "landing") return <LandingView />;
  if (view === "login") return <AuthView initialMode="login" />;
  if (view === "signup") return <AuthView initialMode="signup" />;
  if (view === "rider-dashboard") return <RiderDashboard />;
  return <LandingView />;
}
