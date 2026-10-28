"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VEHICLES, type VehicleClass } from "@/lib/constants";

export type RiderProfileData = {
  name: string; memberSince: string; vehicleClass: string | null; vehiclePlate: string | null;
  rating: number | null; ratingCount: number; completedBookings: number; services: string[];
};

export function RiderProfileDetails({ profile, roleLabel = "rider" }: { profile: RiderProfileData; roleLabel?: string }) {
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  return <div className="space-y-5">
    <div className="flex items-center gap-4"><span aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary/10 text-xl font-semibold text-primary">{initials}</span><div className="min-w-0"><h3 className="text-xl font-semibold break-words">{profile.name}</h3><p className="text-sm text-muted-foreground">With Fetch-It since {new Date(profile.memberSince).toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "Asia/Manila" })}</p></div></div>
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-center"><div><p className="text-xl font-semibold">{profile.ratingCount && profile.rating != null ? `★ ${profile.rating.toFixed(1)}` : `New ${roleLabel}`}</p><p className="text-xs text-muted-foreground">{profile.ratingCount} customer {profile.ratingCount === 1 ? "rating" : "ratings"}</p></div><div><p className="text-xl font-semibold">{profile.completedBookings}</p><p className="text-xs text-muted-foreground">Completed bookings</p></div></div>
    <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Vehicle</dt><dd>{VEHICLES[profile.vehicleClass as VehicleClass]?.label ?? "Not set"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Plate number</dt><dd className="font-semibold break-all">{profile.vehiclePlate || "Not set"}</dd></div><div><dt className="text-muted-foreground mb-2">Approved services</dt><dd className="flex flex-wrap gap-2">{profile.services.length ? profile.services.map(service => <span key={service} className="rounded-full border px-3 py-1">{service === "RIDE" ? "Passenger rides" : "Delivery"}</span>) : "No active service approvals"}</dd></div></dl>
  </div>;
}

export function RiderProfile({ bookingId, id, name, rating, ratingCount, type = "DELIVERY" }: {
  bookingId: string; id?: string; name: string; rating: number; ratingCount?: number; type?: "RIDE" | "DELIVERY";
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<RiderProfileData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        setError(""); setProfile(null);
        const response = await fetch(`/api/bookings/${bookingId}/rider`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn’t load this profile.");
        if (!controller.signal.aborted) setProfile(data.profile);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t load this profile."); }
    })();
    return () => controller.abort();
  }, [bookingId, id, name, open, retry]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-w-0 text-left rounded-md focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View ${name}'s ${type === "RIDE" ? "driver" : "rider"} profile`}><span className="block font-semibold break-words">{name}</span><span className="block text-xs text-muted-foreground">{ratingCount ? `★ ${rating.toFixed(1)} · ${ratingCount} ${ratingCount === 1 ? "rating" : "ratings"}` : `New ${type === "RIDE" ? "driver" : "rider"} · No ratings yet`} · View profile</span></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{type === "RIDE" ? "Driver profile" : "Rider profile"}</DialogTitle><DialogDescription>Your Fetch-It booking partner.</DialogDescription></DialogHeader>{profile ? <RiderProfileDetails profile={profile} roleLabel={type === "RIDE" ? "driver" : "rider"} /> : error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-3" onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : <p role="status" className="text-sm text-muted-foreground">Loading profile…</p>}</DialogContent></Dialog>
  </>;
}
