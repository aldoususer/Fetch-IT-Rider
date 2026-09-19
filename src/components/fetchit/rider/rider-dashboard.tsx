"use client";

// Rider dashboard — stats header, available jobs feed, active job tracker
// with status progression, and e-POD capture (signature + OTP + photo).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  Car,
  Truck,
  Package,
  MapPin,
  Navigation,
  Clock,
  Star,
  Loader2,
  Phone,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  ShieldCheck,
  PenTool,
  KeyRound,
  Camera,
  Wallet,
  PowerCircle,
  Activity,
  X,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppStore, type AuthUser } from "@/lib/store";
import {
  VEHICLES,
  statusLabel,
  type VehicleClass,
  type BookingStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FetchItLogo } from "../shared/logo";
import { StatusBadge } from "../shared/status-badge";
import { SignaturePad } from "../shared/signature-pad";
import { ProfileMenu } from "../shared/profile-menu";

interface RiderStats {
  activeJobs: number;
  completedJobs: number;
  availableJobs: number;
  rating: number;
  totalDeliveries: number;
  isOnline: boolean;
  earnings: number;
  vehicleClass: string | null;
  vehiclePlate: string | null;
}

interface Job {
  id: string;
  refCode: string;
  type: string;
  customerId: string;
  riderId: string | null;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLabel: string;
  dropoffLat: number;
  dropoffLng: number;
  vehicleClass: VehicleClass;
  cargoWeightKg: number;
  passengers: number;
  cargoNotes: string | null;
  scheduledAt: string | null;
  distanceKm: number;
  baseFare: number;
  surgeMultiplier: number;
  totalFare: number;
  currency: string;
  status: BookingStatus;
  etaMinutes: number | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null };
}

export function RiderDashboard() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const refreshUser = useAppStore((s) => s.refreshUser);
  const { toast } = useToast();

  const [stats, setStats] = useState<RiderStats | null>(null);
  const [tab, setTab] = useState<"available" | "active" | "history">("available");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<Job | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/rider/stats", { cache: "no-store" });
      const data = await res.json();
      setStats(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "history") {
        const res = await fetch("/api/bookings?filter=history", { cache: "no-store" });
        const data = await res.json();
        setJobs((data.bookings ?? []) as Job[]);
      } else if (tab === "active") {
        const res = await fetch("/api/bookings?filter=active", { cache: "no-store" });
        const data = await res.json();
        setJobs((data.bookings ?? []) as Job[]);
      } else {
        const res = await fetch("/api/rider/available?includeMatched=true", { cache: "no-store" });
        const data = await res.json();
        setJobs((data.jobs ?? []) as Job[]);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Auto-refresh every 10s for the available feed.
  useEffect(() => {
    if (tab !== "available") return;
    const t = setInterval(() => void loadJobs(), 10000);
    return () => clearInterval(t);
  }, [tab, loadJobs]);

  async function toggleOnline(next: boolean) {
    const res = await fetch("/api/rider/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online: next }),
    });
    if (!res.ok) {
      toast({ title: "Failed to toggle status", variant: "destructive" });
      return;
    }
    const data = await res.json();
    setStats((s) => (s ? { ...s, isOnline: data.isOnline } : s));
    await refreshUser();
    toast({
      title: data.isOnline ? "You're online" : "You're offline",
      description: data.isOnline
        ? "You'll receive new job matches automatically."
        : "You won't see new jobs until you go back online.",
    });
    if (data.isOnline) void loadJobs();
  }

  async function accept(job: Job) {
    // For PENDING jobs (no rider assigned), claim via PATCH.
    // For MATCHED jobs already pre-assigned, accept via PATCH status.
    const res = await fetch(`/api/bookings/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACCEPTED" }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({
        title: "Accept failed",
        description: data.error || "Could not accept this job.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Job accepted", description: job.refCode });
    setActiveJob(data.booking);
    setTab("active");
    await loadStats();
    await loadJobs();
  }

  // Clicking the logo always brings you back to the main dashboard view.
  function goHome() {
    setActiveJob(null);
    setTab("available");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button
            type="button"
            onClick={goHome}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <FetchItLogo />
          </button>
          <div className="flex items-center gap-3">
            <OnlineToggle
              isOnline={stats?.isOnline ?? false}
              onToggle={(v) => toggleOnline(v)}
            />
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">
                {stats?.vehicleClass ? VEHICLES[stats.vehicleClass as VehicleClass]?.label : "—"}
                {stats?.vehiclePlate ? ` · ${stats.vehiclePlate}` : ""}
              </span>
            </div>
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel="Rider"
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Welcome + stats */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Hey, {user?.name?.split(" ")[0] ?? "rider"} 🛵
            </h1>
            <p className="text-muted-foreground mt-1">
              {stats?.isOnline
                ? "You're online — new jobs will appear below."
                : "Go online to start receiving job matches."}
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<Activity className="h-5 w-5 text-primary" />}
            label="Active jobs"
            value={stats?.activeJobs ?? 0}
            loading={!stats}
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            label="Completed"
            value={stats?.completedJobs ?? 0}
            loading={!stats}
          />
          <StatCard
            icon={<Star className="h-5 w-5 text-amber-500 fill-amber-500" />}
            label="Rating"
            value={(stats?.rating ?? 5).toFixed(1)}
            loading={!stats}
          />
          <StatCard
            icon={<Wallet className="h-5 w-5 text-primary" />}
            label="Earnings"
            value={`₱${(stats?.earnings ?? 0).toFixed(2)}`}
            loading={!stats}
          />
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="available" className="gap-1.5">
              <Package className="h-4 w-4" /> Available
              {stats?.availableJobs != null && stats.availableJobs > 0 && (
                <span className="ml-1 rounded-full bg-primary/15 text-primary text-xs px-1.5">
                  {stats.availableJobs}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="active" className="gap-1.5">
              <CircleDot className="h-4 w-4" /> Active
              {stats?.activeJobs ? (
                <span className="ml-1 rounded-full bg-primary/15 text-primary text-xs px-1.5">
                  {stats.activeJobs}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <Clock className="h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Job list */}
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="border">
                <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyJobs
            tab={tab}
            isOnline={stats?.isOnline ?? false}
            onGoOnline={() => toggleOnline(true)}
          />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isAvailable={tab === "available"}
                onAccept={() => accept(job)}
                onOpen={() => setActiveJob(job)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Active job modal */}
      <Dialog open={!!activeJob} onOpenChange={(o) => !o && setActiveJob(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          {activeJob && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Navigation className="h-5 w-5 text-primary" />
                  {activeJob.type === "RIDE" ? "Ride" : "Job"} · {activeJob.refCode}
                </DialogTitle>
                <DialogDescription>
                  {statusLabel(activeJob.status, activeJob.type === "RIDE" ? "RIDE" : "DELIVERY")}
                </DialogDescription>
              </DialogHeader>
              <ActiveJobFlow
                job={activeJob}
                onUpdated={(updated) => {
                  setActiveJob((prev) => (prev ? { ...prev, ...updated } : prev));
                  void loadJobs();
                  void loadStats();
                }}
                onClose={() => setActiveJob(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Rider dashboard · Built with Next.js 16
      </footer>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="border">
      <CardContent className="py-4">
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10">
              {icon}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold leading-tight">{value}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OnlineToggle({
  isOnline,
  onToggle,
}: {
  isOnline: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      variant={isOnline ? "default" : "outline"}
      size="sm"
      onClick={() => onToggle(!isOnline)}
      className={cn("gap-1.5", isOnline && "ring-2 ring-emerald-400/40")}
    >
      <PowerCircle className={cn("h-4 w-4", isOnline ? "text-emerald-500" : "text-muted-foreground")} />
      {isOnline ? "Online" : "Offline"}
    </Button>
  );
}

function EmptyJobs({
  tab,
  isOnline,
  onGoOnline,
}: {
  tab: "available" | "active" | "history";
  isOnline: boolean;
  onGoOnline: () => void;
}) {
  if (tab === "history") {
    return (
      <Card className="border-2 border-dashed bg-card">
        <CardContent className="py-16 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-muted grid place-items-center mb-4">
            <Clock className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg">No completed deliveries yet</h3>
          <p className="text-muted-foreground mt-1">
            Accept your first job to start earning.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-2 border-dashed bg-card">
      <CardContent className="py-16 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 grid place-items-center mb-4">
          <Package className="h-7 w-7 text-primary" />
        </div>
        <h3 className="font-semibold text-lg">
          {tab === "available" ? "No jobs available right now" : "No active jobs"}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          {tab === "available"
            ? isOnline
              ? "New jobs matching your vehicle will appear here automatically."
              : "You're offline — go online to start receiving job matches."
            : "Accept a job from the Available tab to start driving."}
        </p>
        {tab === "available" && !isOnline && (
          <Button className="mt-5" onClick={onGoOnline}>
            <PowerCircle className="h-4 w-4" /> Go online
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function JobCard({
  job,
  isAvailable,
  onAccept,
  onOpen,
}: {
  job: Job;
  isAvailable: boolean;
  onAccept: () => void;
  onOpen: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const vIcon = useVehicleIcon(job.vehicleClass);
  const v = VEHICLES[job.vehicleClass];

  async function handleAccept() {
    setAccepting(true);
    try {
      onAccept();
    } finally {
      setAccepting(false);
    }
  }

  return (
    <Card className="border hover:shadow-md transition flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">{job.refCode}</span>
              <JobTypeBadge type={job.type} />
              <StatusBadge status={job.status} type={job.type === "RIDE" ? "RIDE" : "DELIVERY"} />
            </div>
            <CardTitle className="text-base mt-1.5 truncate">{job.dropoffLabel}</CardTitle>
            <CardDescription className="flex items-center gap-1 mt-0.5">
              <MapPin className="h-3.5 w-3.5" /> from {job.pickupLabel}
            </CardDescription>
          </div>
          <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary shrink-0">
            {vIcon}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label={job.type === "RIDE" ? "Passenger" : "Customer"} value={job.customer?.name ?? "—"} icon={<Package className="h-4 w-4" />} />
          <Stat label="Distance" value={`${job.distanceKm} km`} icon={<Navigation className="h-4 w-4" />} />
          <Stat label="Payout" value={`₱${job.totalFare.toFixed(2)}`} icon={<Wallet className="h-4 w-4" />} />
          {job.type === "RIDE" ? (
            <Stat label="Passengers" value={String(job.passengers ?? 1)} icon={<Users className="h-4 w-4" />} />
          ) : (
            <Stat label="Cargo" value={`${job.cargoWeightKg} kg`} icon={<Package className="h-4 w-4" />} />
          )}
        </div>
        {job.type !== "RIDE" && job.cargoNotes && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 italic">
            {job.cargoNotes}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {isAvailable ? (
            <Button size="sm" className="flex-1" onClick={handleAccept} disabled={accepting}>
              {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {job.type === "RIDE" ? "Accept ride" : "Accept job"}
            </Button>
          ) : (
            <Button size="sm" className="flex-1" onClick={onOpen}>
              <Navigation className="h-3.5 w-3.5" /> Open
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function JobTypeBadge({ type }: { type: string }) {
  const isRide = type === "RIDE";
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 font-medium border",
        isRide
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : "bg-amber-100 text-amber-800 border-amber-200",
      )}
    >
      {isRide ? "Ride" : "Delivery"}
    </Badge>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}

// ------------------------------ Active job flow ------------------------------
const STATUS_STEPS: BookingStatus[] = ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
const NEXT_STATUS: Record<BookingStatus, BookingStatus | null> = {
  PENDING: null,
  MATCHED: "ACCEPTED",
  ACCEPTED: "PICKED_UP",
  PICKED_UP: "IN_TRANSIT",
  IN_TRANSIT: "DELIVERED",
  DELIVERED: null,
  CANCELLED: null,
};

function ActiveJobFlow({
  job,
  onUpdated,
  onClose,
}: {
  job: Job;
  onUpdated: (u: Partial<Job>) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<BookingStatus>(job.status);
  const [updating, setUpdating] = useState(false);
  const [showProof, setShowProof] = useState(false);

  // Live broadcasting of rider location every 4s when status is ACCEPTED/PICKED_UP/IN_TRANSIT
  const latRef = useRef<number>(job.pickupLat);
  const lngRef = useRef<number>(job.pickupLng);
  const lastDir = useRef<number>(0);

  useEffect(() => {
    // Initialize to pickup location
    latRef.current = job.pickupLat;
    lngRef.current = job.pickupLng;
  }, [job.id, job.pickupLat, job.pickupLng]);

  // Re-subscribe to socket (if configured) + broadcast position toward the destination
  useEffect(() => {
    if (!["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(status)) return;
    let cancelled = false;
    (async () => {
      const { getTrackingSocket } = await import("@/lib/socket");
      const socket = getTrackingSocket();
      if (!socket) return; // no tracking service configured — polling covers updates
      socket.emit("subscribe", { bookingId: job.id });
    })();
    const interval = setInterval(async () => {
      if (cancelled) return;
      // Move toward destination by a small fraction each tick (simulated GPS).
      const target = status === "ACCEPTED" || status === "PICKED_UP"
        ? { lat: job.pickupLat, lng: job.pickupLng }
        : { lat: job.dropoffLat, lng: job.dropoffLng };
      const dx = target.lng - lngRef.current;
      const dy = target.lat - latRef.current;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-5) return;
      const step = 0.18; // fraction of remaining distance per tick
      latRef.current += dy * step;
      lngRef.current += dx * step;
      lastDir.current = (Math.atan2(dy, dx) * 180) / Math.PI;
      const lat = latRef.current;
      const lng = lngRef.current;
      // Persist to backend
      fetch(`/api/bookings/${job.id}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          speedKph: 32,
          heading: lastDir.current,
          etaMinutes: job.etaMinutes ?? null,
        }),
      }).catch(() => {});
      // Broadcast via socket (no-op when no tracking service is configured)
      try {
        const { getTrackingSocket } = await import("@/lib/socket");
        getTrackingSocket()?.emit("rider:location", {
          bookingId: job.id,
          lat,
          lng,
          speedKph: 32,
          heading: lastDir.current,
          etaMinutes: job.etaMinutes ?? null,
        });
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, job.id, job.pickupLat, job.pickupLng, job.dropoffLat, job.dropoffLng, job.etaMinutes]);

  async function advance(to: BookingStatus) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/bookings/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setStatus(data.booking.status);
      onUpdated({ status: data.booking.status, etaMinutes: data.booking.etaMinutes });
      // Broadcast status change so the customer UI updates (no-op when no
      // tracking service is configured)
      try {
        const { getTrackingSocket } = await import("@/lib/socket");
        getTrackingSocket()?.emit("status:change", {
          bookingId: job.id,
          status: data.booking.status,
        });
      } catch {
        /* ignore */
      }
      toast({
        title: `Status: ${statusLabel(data.booking.status as BookingStatus, isRide ? "RIDE" : "DELIVERY")}`,
        description: job.refCode,
      });
      if (data.booking.status === "DELIVERED") {
        setShowProof(false);
      }
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  }

  const nextStatus = NEXT_STATUS[status];
  const canAdvance = nextStatus != null;
  const isRide = job.type === "RIDE";
  const nextLabel = nextStatus
    ? isRide
      ? {
          ACCEPTED: "I'm on my way",
          PICKED_UP: "Passenger on board",
          IN_TRANSIT: "Start trip",
          DELIVERED: "Complete ride",
        }[nextStatus]
      : {
          ACCEPTED: "I'm on my way",
          PICKED_UP: "Mark as picked up",
          IN_TRANSIT: "Start delivery",
          DELIVERED: "Mark delivered",
        }[nextStatus]
    : null;

  const isDelivered = status === "DELIVERED";

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="flex items-center justify-between gap-2">
        {STATUS_STEPS.map((s) => {
          const idx = STATUS_STEPS.indexOf(s);
          const currentIdx = STATUS_STEPS.indexOf(status);
          const active = idx <= currentIdx;
          return (
            <div key={s} className="flex-1 flex flex-col items-center text-center">
              <div
                className={cn(
                  "h-9 w-9 rounded-full grid place-items-center border-2",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border",
                )}
              >
                {active ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <div className={cn("text-xs mt-1.5", active ? "text-foreground font-medium" : "text-muted-foreground")}>
                {statusLabel(s, isRide ? "RIDE" : "DELIVERY")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30 aspect-[16/8]">
        <JobMiniMap
          pickup={{ lat: job.pickupLat, lng: job.pickupLng }}
          dropoff={{ lat: job.dropoffLat, lng: job.dropoffLng }}
        />
      </div>

      {/* Itinerary */}
      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium">{job.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-3 border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 rounded-full bg-rose-100 text-rose-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-rose-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium">{job.dropoffLabel}</p>
          </div>
        </div>
      </div>

      {/* Cargo / passenger info */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm border rounded-lg p-3 bg-muted/30">
        {isRide ? (
          <Stat label="Passengers" value={String(job.passengers ?? 1)} icon={<Users className="h-4 w-4" />} />
        ) : (
          <Stat label="Cargo" value={`${job.cargoWeightKg} kg`} icon={<Package className="h-4 w-4" />} />
        )}
        <Stat label="Distance" value={`${job.distanceKm} km`} icon={<Navigation className="h-4 w-4" />} />
        <Stat label="Payout" value={`₱${job.totalFare.toFixed(2)}`} icon={<Wallet className="h-4 w-4" />} />
        {!isRide && job.cargoNotes && (
          <div className="col-span-2 sm:col-span-3 text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 italic">
            {job.cargoNotes}
          </div>
        )}
      </div>

      {/* Customer contact */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="grid place-items-center h-10 w-10 rounded-full bg-primary/15 text-primary">
          <Package className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{job.customer?.name}</p>
          <p className="text-xs text-muted-foreground">Customer</p>
        </div>
        {job.customer?.phone && (
          <a href={`tel:${job.customer.phone}`}>
            <Button size="icon" variant="outline" className="h-9 w-9">
              <Phone className="h-4 w-4" />
            </Button>
          </a>
        )}
      </div>

      {/* Action buttons */}
      {!isDelivered ? (
        <div className="flex flex-col gap-2">
          {canAdvance && (
            <Button
              size="lg"
              onClick={() => advance(nextStatus!)}
              disabled={updating}
              className="w-full"
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {nextLabel}
            </Button>
          )}
          {status === "IN_TRANSIT" && !isRide && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => setShowProof((s) => !s)}
              disabled={updating}
            >
              <ShieldCheck className="h-4 w-4" /> Capture e-POD
            </Button>
          )}
        </div>
      ) : (
        <Card className="border-emerald-300 bg-emerald-50/40">
          <CardContent className="py-4 flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            <div className="flex-1">
              <p className="font-medium">{isRide ? "Ride complete" : "Delivery complete"}</p>
              <p className="text-sm text-muted-foreground">
                Payout of ₱{job.totalFare.toFixed(2)} added to your wallet.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {showProof && (
        <ProofCapture
          bookingId={job.id}
          onDone={() => {
            setShowProof(false);
            setStatus("DELIVERED");
            onUpdated({ status: "DELIVERED" });
            void loadStatsThroughReload(onUpdated, job.id);
          }}
        />
      )}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

// After a successful proof submission, refresh stats.
async function loadStatsThroughReload(_onUpdated: (u: Partial<Job>) => void, _jobId: string) {
  // No-op — the dialog will close and the dashboard's own loadStats fires.
}

// ------------------------------ e-POD capture ------------------------------
function ProofCapture({
  bookingId,
  onDone,
}: {
  bookingId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [otp, setOtp] = useState("");
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Max 1.5 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit() {
    setError(null);
    if (!otp && !signatureSvg && !photoDataUrl) {
      setError("Provide at least one proof artifact (OTP, signature, or photo).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otp: otp || undefined,
          signatureSvg: signatureSvg || undefined,
          photoDataUrl: photoDataUrl || undefined,
          recipientName: recipientName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Proof submission failed");
      }
      toast({
        title: "Proof of delivery captured",
        description: `${data.proofs?.length ?? 0} artifact(s) submitted.`,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Capture e-POD
        </CardTitle>
        <CardDescription>
          Collect at least one of: OTP from the customer, recipient signature,
          or a drop-off photo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* OTP */}
        <div className="space-y-2">
          <Label htmlFor="otp" className="text-sm font-medium flex items-center gap-1.5">
            <KeyRound className="h-4 w-4 text-primary" /> OTP from customer
          </Label>
          <Input
            id="otp"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="font-mono text-lg tracking-widest"
          />
          <p className="text-xs text-muted-foreground">
            Ask the customer to reveal their hand-off code in their tracking view.
          </p>
        </div>

        {/* Signature */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <PenTool className="h-4 w-4 text-primary" /> Recipient signature
          </Label>
          <SignaturePad onChange={setSignatureSvg} />
        </div>

        {/* Recipient name */}
        <div className="space-y-2">
          <Label htmlFor="recipient" className="text-sm font-medium">
            Recipient name (optional)
          </Label>
          <Input
            id="recipient"
            placeholder="John Smith"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
          />
        </div>

        {/* Photo */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-primary" /> Drop-off photo (optional)
          </Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhotoChange}
            className="hidden"
          />
          {photoDataUrl ? (
            <div className="relative">
              <img
                src={photoDataUrl}
                alt="Drop-off"
                className="rounded-lg border w-full h-32 object-cover"
              />
              <Button
                size="icon"
                variant="outline"
                className="absolute top-1 right-1 h-7 w-7 bg-card"
                onClick={() => setPhotoDataUrl(null)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed h-20"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Upload / take photo
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <Button className="w-full" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Submit proof & complete delivery
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Job mini map ------------------------------
function JobMiniMap({
  pickup,
  dropoff,
}: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}) {
  // Same computation as the customer mini map, but without rider.
  const bounds = computeBounds([pickup, dropoff]);
  const W = 400, H = 200;
  const p = project(pickup, bounds, W, H);
  const d = project(dropoff, bounds, W, H);
  const midX = (p.x + d.x) / 2;
  const midY = (p.y + d.y) / 2 - 25;
  const path = `M ${p.x} ${p.y} Q ${midX} ${midY} ${d.x} ${d.y}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="streets3" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
        </pattern>
        <linearGradient id="routeGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#streets3)" />
      <path d={path} fill="none" stroke="url(#routeGrad2)" strokeWidth="3.5" strokeLinecap="round" />
      <g transform={`translate(${p.x}, ${p.y})`}>
        <circle r="10" fill="#10b981" opacity="0.2" />
        <circle r="6" fill="#10b981" />
      </g>
      <g transform={`translate(${d.x}, ${d.y})`}>
        <circle r="10" fill="#ef4444" opacity="0.2" />
        <circle r="6" fill="#ef4444" />
      </g>
    </svg>
  );
}

function computeBounds(points: { lat: number; lng: number }[]): Bounds {
  if (points.length === 0) return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLng = points[0].lng, maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const padLat = Math.max(0.001, (maxLat - minLat) * 0.15);
  const padLng = Math.max(0.001, (maxLng - minLng) * 0.15);
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  };
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function project(p: { lat: number; lng: number }, b: Bounds, w: number, h: number) {
  const x = ((p.lng - b.minLng) / (b.maxLng - b.minLng)) * w;
  const y = h - ((p.lat - b.minLat) / (b.maxLat - b.minLat)) * h;
  return { x, y };
}

// ------------------------------ Vehicle icon helper ------------------------------
function useVehicleIcon(vc: VehicleClass) {
  switch (vc) {
    case "MOTORCYCLE":
      return <Bike className="h-5 w-5" />;
    case "TRICYCLE":
      return <CircleDot className="h-5 w-5" />;
    case "SEDAN":
      return <Car className="h-5 w-5" />;
    case "CLOSED_VAN":
      return <Truck className="h-5 w-5" />;
    case "FLATBED":
      return <Truck className="h-5 w-5" />;
    case "REFRIGERATED":
      return <Truck className="h-5 w-5" />;
  }
}
