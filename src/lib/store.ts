// Client-side auth + UI state for Fetch-It (RIDER app).
// Uses Zustand for state management; the session itself is backed by an
// httpOnly cookie set by the /api/auth/* endpoints.
//
// This build is dedicated to riders and is deployed as its own standalone
// website/PWA. CUSTOMER sessions are ignored here — customers must use
// the separate Fetch-It Customer app.

"use client";

import { create } from "zustand";

export type Role = "CUSTOMER" | "RIDER";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role | "ADMIN";
  phone?: string | null;
  vehicleClass?: string | null;
  vehiclePlate?: string | null;
  rating?: number;
  totalDeliveries?: number;
  isOnline?: boolean;
  lat?: number | null;
  lng?: number | null;
}

export type AppView =
  | "landing"
  | "login"
  | "signup"
  | "rider-dashboard";

// Sessions of other roles (e.g. CUSTOMER) must never see this app's UI.
function isAllowedRole(role: AuthUser["role"] | undefined): boolean {
  return role === "RIDER";
}

interface AppState {
  user: AuthUser | null;
  bootstrapped: boolean;
  // Top-level navigation; dashboards handle their own sub-views internally.
  view: AppView;
  // Login form prefills role so the UI can show a tailored form.
  pendingRole: Role | null;
  setView: (v: AppView) => void;
  setPendingRole: (r: Role | null) => void;
  setUser: (u: AuthUser | null) => void;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
  // Hydrate user from the server (used after role-dependent writes).
  refreshUser: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  bootstrapped: false,
  view: "landing",
  pendingRole: null,
  setView: (v) => set({ view: v }),
  setPendingRole: (r) => set({ pendingRole: r }),
  setUser: (u) =>
    set({
      user: isAllowedRole(u?.role) ? u : null,
      view: isAllowedRole(u?.role) ? "rider-dashboard" : "landing",
    }),
  bootstrap: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        set({ bootstrapped: true });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      const allowed = isAllowedRole(data.user?.role);
      set({
        user: allowed ? data.user : null,
        view: allowed ? "rider-dashboard" : "landing",
        bootstrapped: true,
      });
    } catch {
      set({ bootstrapped: true });
    }
  },
  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    set({ user: null, view: "landing", pendingRole: null });
  },
  refreshUser: async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { user: AuthUser | null };
    if (data.user) set({ user: data.user });
  },
}));
