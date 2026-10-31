// Client-side auth + UI state for Fetch-It (RIDER app).
// Uses Zustand for state management; the session itself is backed by an
// httpOnly cookie set by the /api/auth/* endpoints.
//
// This build is dedicated to riders and is deployed as its own standalone
// website/PWA. CUSTOMER sessions are ignored here — customers must use
// the separate Fetch-It Customer app.

"use client";

import { create } from "zustand";
import { setRiderPushAccount } from './rider-push';

let sessionEpoch = 0;
let pendingLogout = false;
const LOGOUT_KEY = "fetchit:rider:pending-logout";
function hasPendingLogout() {
  try { return pendingLogout || localStorage.getItem(LOGOUT_KEY) === "1"; }
  catch { return pendingLogout; }
}
function setPendingLogout(value: boolean) {
  pendingLogout = value;
  try { if (value) localStorage.setItem(LOGOUT_KEY, "1"); else localStorage.removeItem(LOGOUT_KEY); }
  catch { /* Retain the in-memory flag when device storage is unavailable. */ }
}
function guestView(view: AppView): AppView {
  return view === "login" || view === "signup" ? view : "landing";
}

export type Role = "CUSTOMER" | "RIDER";

export interface AuthUser {
  roadRouting?: boolean;
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
  setUser: (u) => {
    sessionEpoch++;
    if (isAllowedRole(u?.role)) setPendingLogout(false);
    set({
      user: isAllowedRole(u?.role) ? u : null,
      view: isAllowedRole(u?.role) ? "rider-dashboard" : "landing",
    });
  },
  bootstrap: async () => {
    const epoch = sessionEpoch;
    try {
      if (hasPendingLogout()) {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error("Sign-out is waiting for a connection.");
        if (epoch !== sessionEpoch) return;
        setPendingLogout(false);
      }
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (epoch !== sessionEpoch) return;
      if (!res.ok) {
        set({ user: null, view: guestView(get().view), bootstrapped: true });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      if (epoch !== sessionEpoch) return;
      const allowed = isAllowedRole(data.user?.role);
      set({
        user: allowed ? data.user : null,
        view: allowed ? "rider-dashboard" : guestView(get().view),
        bootstrapped: true,
      });
    } catch {
      if (epoch === sessionEpoch) set({ bootstrapped: true });
    }
  },
  logout: async () => {
    if (typeof window !== "undefined" && !window.confirm("Are you sure you want to log out of Fetch-It?")) return;
    const epoch = ++sessionEpoch;
    void setRiderPushAccount(null).catch(() => {});
    setPendingLogout(true);
    set({ user: null, view: "landing", pendingRole: null });
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok && epoch === sessionEpoch) setPendingLogout(false);
    } catch { /* Retry cookie revocation before checking the account on reconnect. */ }
  },
  refreshUser: async () => {
    const epoch = sessionEpoch;
    try {
      if (hasPendingLogout()) {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) return;
        if (epoch !== sessionEpoch) return;
        setPendingLogout(false);
      }
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (epoch !== sessionEpoch) return;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) set({ user: null, view: guestView(get().view) });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      if (epoch !== sessionEpoch) return;
      if (isAllowedRole(data.user?.role)) set({ user: data.user });
      else set({ user: null, view: guestView(get().view) });
    } catch { /* A temporary network failure must not restore or switch accounts. */ }
  },
}));
