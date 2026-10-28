"use client";
import { BrowserLocation } from "./browser-location";
import { RiderProfileDetails, type RiderProfileData } from "../shared/rider-profile";
import { prepareDeliveryPhoto } from "@/lib/epod-photo-client";
import { demoSplit, isDemoPayment } from "@/lib/payment-policy";

// Rider dashboard — stats header, available jobs feed, active job tracker
// with ride pickup OTP verification and delivery e-POD (signature + photo).

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
  RefreshCw,
  ChevronDown,
  X,
  Upload,
  Users,
  Copy,
  Smartphone,
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
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { useAppStore, type AuthUser } from "@/lib/store";
import {
  VEHICLES,
  statusLabel,
  type VehicleClass,
  type BookingStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FetchItLogo } from "../shared/logo";
import { PaymentCard } from "../shared/payment-card";
import { ReleaseBooking } from "../shared/release-booking";
import { StatusBadge } from "../shared/status-badge";
import { JobRouteMap } from "./job-route-map";
import { SignaturePad } from "../shared/signature-pad";
import { ProfileMenu } from "../shared/profile-menu";
import "./rider-dashboard.css";

interface RiderStats {
  activeJobs: number;
  completedJobs: number;
  availableJobs: number;
  rating: number;
  totalDeliveries: number;
  isOnline: boolean;
  earnings: number;
  demoEarnings: number;
  demoPaidOut: number;
  demoAwaitingPayout: number;
  vehicleClass: string | null;
  vehiclePlate: string | null;
}

interface Job {
  id: string;
  refCode: string;
  // Rider-only tracking ticket (R0001 / D0001) + its encoded native-app
  // payload — see src/lib/ticket.ts. Never present in the customer app.
  ticketId: string | null;
  ticket: string | null;
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
  paymentMethod: string;
  demoCommissionBps: number | null;
  demoRiderEarnings: number | null;
  currency: string;
  status: BookingStatus;
  assignmentExpiresAt?: string | null;
  etaMinutes: number | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null };
}

type JobTab = "available" | "active" | "history";

function riderShare(job: Job) {
  return isDemoPayment(job.paymentMethod) ? job.demoRiderEarnings ?? demoSplit(job.totalFare.toFixed(2), job.demoCommissionBps ?? 1500).riderEarnings : job.totalFare;
}

export function RiderDashboard() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const refreshUser = useAppStore((s) => s.refreshUser);
  const { toast } = useToast();

  const [profile, setProfile] = useState<RiderProfileData | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<RiderStats | null>(null);
  const [tab, setTab] = useState<JobTab>("available");
  const [jobLists, setJobLists] = useState<Partial<Record<JobTab, Job[]>>>({});
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobErrors, setJobErrors] = useState<Partial<Record<JobTab, string>>>({});
  const jobsRequest = useRef(0);
  const jobs = jobLists[tab] ?? [];
  // Only a tab's first load uses skeletons. Refreshes preserve its existing
  // cards and their mounted state, including any open job actions.
  const loading = jobLists[tab] === undefined && !jobErrors[tab];

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/rider/stats", { cache: "no-store", signal });
      if (!res.ok) throw new Error("Stats unavailable");
      const data = await res.json();
      if (!signal?.aborted) setStats(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadJobs = useCallback(async (signal?: AbortSignal) => {
    const request = ++jobsRequest.current;
    try {
      const path = tab === "available" ? "/api/rider/available?includeMatched=true" : `/api/bookings?filter=${tab}`;
      const res = await fetch(path, { cache: "no-store", signal });
      if (!res.ok) throw new Error("Jobs unavailable");
      const data = await res.json();
      if (signal?.aborted || request !== jobsRequest.current) return;
      const latest = tab === "available" ? data.jobs : data.bookings;
      if (!Array.isArray(latest)) throw new Error("Jobs unavailable");
      setJobLists(previous => ({ ...previous, [tab]: latest as Job[] }));
      setJobErrors(previous => ({ ...previous, [tab]: undefined }));
      if (tab === "active") setActiveJob(previous => previous ? latest.find(job => job.id === previous.id) ?? null : null);
    } catch (error) {
      if (!signal?.aborted && request === jobsRequest.current) setJobErrors(previous => ({ ...previous, [tab]: "Couldn’t update jobs. Please try again." }));
      throw error;
    }
  }, [tab]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void loadStats(controller.signal); });
    return () => controller.abort();
  }, [loadStats]);

  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void loadJobs(controller.signal).catch(() => {}); });
    return () => controller.abort();
  }, [loadJobs, tab]);

  // Pause hidden/offline pages, prevent overlaps, and back off after failures.
  useVisiblePoll(tab !== "history" && user ? `${user.id}:${tab}` : "", async signal => {
    await Promise.all([loadJobs(signal), loadStats(signal)]);
  }, 10000);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/rider/profile", { signal: controller.signal, cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (data && !controller.signal.aborted) setProfile(data.profile); }).catch(() => {});
    return () => controller.abort();
  }, [user?.id, stats?.rating, stats?.completedJobs]);

  async function toggleOnline(next: boolean) {
    if (statusPending) return;
    setStatusPending(true);
    try {
      const res = await fetch("/api/rider/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ online: next }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update your availability.");
      setStats(previous => previous ? { ...previous, isOnline: data.isOnline } : previous);
      await refreshUser().catch(() => {});
      toast({ title: data.isOnline ? "You're online" : "You're offline", description: data.isOnline ? "Jobs matching your vehicle will appear on the board." : "Go online again when you're ready for jobs." });
      if (data.isOnline) void loadJobs().catch(() => {});
    } catch (error) { toast({ title: "Availability not updated", description: error instanceof Error ? error.message : "Check your connection and try again.", variant: "destructive" }); }
    finally { setStatusPending(false); }
  }
  async function refreshBoard() {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([loadJobs(), loadStats()]); } catch { /* Existing board retry message handles failed refreshes. */ }
    finally { setRefreshing(false); }
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
      throw new Error(data.error || "Could not accept this job.");
    }
    jobsRequest.current++;
    toast({ title: "Job accepted", description: job.refCode });
    setJobLists(previous => ({ ...previous,
      available: previous.available?.filter(item => item.id !== job.id),
      active: [data.booking, ...(previous.active ?? []).filter(item => item.id !== job.id)],
    }));
    setActiveJob(data.booking);
    setTab("active");
    void loadStats();
  }

  // Clicking the logo always brings you back to the main dashboard view.
  function goHome() {
    setActiveJob(null);
    setTab("available");
  }

  return (
    <div className="rd">
      {/* Header */}
      <header className="rd-header">
        <div className="rd-header-inner">
          <button
            type="button"
            onClick={goHome}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <FetchItLogo />
          </button>
          <div className="rd-account">
            <OnlineToggle
              pending={statusPending}
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

      <main className="rd-main">
        <section className={cn("rd-welcome", stats?.isOnline && "is-online")}>
          <div><p className="rd-eyebrow">YOUR DAY, ON THE MOVE</p><h1>Let’s get moving, {user?.name?.split(" ")[0] ?? "rider"}.</h1><p>{stats?.isOnline ? "You're online. Your next job could be just around the corner." : "Your jobs, routes and earnings. All in one place."}</p></div>
          <div className="rd-vehicle"><span className="rd-availability-dot"/>{stats?.vehicleClass ? VEHICLES[stats.vehicleClass as VehicleClass]?.label ?? stats.vehicleClass : "Your rider workspace"}{stats?.vehiclePlate && <span>{stats.vehiclePlate}</span>}</div>
        </section>

        {/* Stats grid */}
        <div className="rd-stats" aria-label="Rider activity">
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
            value={profile?.ratingCount ? (profile.rating ?? 0).toFixed(1) : "New"}
            loading={!stats}
          />
          <StatCard
            icon={<Wallet className="h-5 w-5 text-primary" />}
            label="Completed cash fares"
            value={`₱${(stats?.earnings ?? 0).toFixed(2)}`}
            loading={!stats}
          />
        </div>

        {!!stats && (stats.demoEarnings > 0 || stats.demoAwaitingPayout > 0 || stats.demoPaidOut > 0) && <details className="rd-earnings">
          <summary><Wallet size={18} aria-hidden="true"/><span>Online earnings<small>Test transactions</small></span><strong>₱{stats.demoEarnings.toFixed(2)}</strong><ChevronDown size={16} aria-hidden="true"/></summary>
          <div><p>Test payments and payouts — no money transferred.</p><dl><div><dt>Earned</dt><dd>₱{stats.demoEarnings.toFixed(2)}</dd></div><div><dt>Awaiting review</dt><dd>₱{stats.demoAwaitingPayout.toFixed(2)}</dd></div><div><dt>Payouts</dt><dd>₱{stats.demoPaidOut.toFixed(2)}</dd></div></dl></div>
        </details>}
        {user && <BrowserLocation key={user.id} userId={user.id} needed={!!stats?.isOnline || (stats?.activeJobs ?? 0) > 0} />}
        {profile && <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Your rider profile · {profile.ratingCount && profile.rating != null ? `★ ${profile.rating.toFixed(1)} (${profile.ratingCount} ratings)` : "No ratings yet"}</summary><div className="pt-4"><RiderProfileDetails profile={profile} /></div></details>}
        <div className="rd-board-heading"><div><p className="rd-eyebrow">YOUR WORKSPACE</p><h2>Jobs board</h2></div><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refreshBoard()} aria-label="Refresh jobs"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""}/>Refresh</Button></div>
        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="rd-tabs">
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
        {jobErrors[tab] && <div role="status" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <p>{jobLists[tab] ? "Couldn’t refresh. Your current jobs remain visible." : jobErrors[tab]}</p>
          <Button variant="outline" size="sm" onClick={() => void loadJobs().catch(() => {})}>Try again</Button>
        </div>}
        {loading ? (
          <div className="rd-jobs-grid">
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
        ) : jobLists[tab] === undefined ? null : jobs.length === 0 ? (
          <EmptyJobs
            tab={tab}
            isOnline={stats?.isOnline ?? false}
            onGoOnline={() => toggleOnline(true)}
          />
        ) : (
          <div className="rd-jobs-grid">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isAvailable={tab === "available"}
                onAccept={() => accept(job)}
                onReleased={() => { setActiveJob(null); void loadJobs(); void loadStats(); }}
                onOpen={() => setActiveJob(job)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Active job modal */}
      <Dialog open={!!activeJob} onOpenChange={(o) => !o && setActiveJob(null)}>
        <DialogContent className="rd-job-dialog sm:max-w-2xl max-h-[92vh] overflow-y-auto">
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
                  void loadJobs().catch(() => {});
                  void loadStats();
                }}
                onClose={() => setActiveJob(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <footer className="rd-footer">
        Fetch-It Rider · Your next move starts here.
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
  return <article className="rd-stat">{loading ? <Skeleton className="h-12 w-full"/> : <><div className="rd-stat-icon" aria-hidden="true">{icon}</div><div className="rd-stat-copy"><p>{label}</p><strong>{value}</strong></div></>}</article>;
}

function OnlineToggle({
  pending,
  isOnline,
  onToggle,
}: {
  pending: boolean;
  isOnline: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      variant={isOnline ? "default" : "outline"}
      size="sm"
      onClick={() => onToggle(!isOnline)}
      disabled={pending}
      className={cn("rd-online-toggle", isOnline && "is-online")}
    >
      <PowerCircle className={cn("h-4 w-4", isOnline ? "text-emerald-500" : "text-muted-foreground")} />
      {pending ? "Updating…" : isOnline ? "Online" : "Offline"}
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
      <Card className="rd-empty border-2 border-dashed bg-card">
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
    <Card className="rd-empty border-2 border-dashed bg-card">
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

// Copy-pasteable handoff to the (separate, not-yet-built) native tracking
// app — the PWA can't run GPS in the background, so the rider pastes this
// ticket into the native app once, which then reports live location back
// via the bookingId embedded inside.
function TrackingTicketCard({ job }: { job: Job }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copyTicket() {
    if (!job.ticket) return;
    try {
      await navigator.clipboard.writeText(job.ticket);
      setCopied(true);
      toast({ title: "Ticket copied", description: `${job.ticketId} · paste it into the tracking app` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Copy it manually instead.", variant: "destructive" });
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4 text-primary" />
          Optional tracking ticket
        </div>
        <span className="font-mono text-sm font-semibold text-primary">{job.ticketId}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Use Share location on your dashboard for browser GPS. This ticket is only needed
        if you use a compatible native tracking app.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        onClick={copyTicket}
        disabled={!job.ticket}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy ticket"}
      </Button>
    </div>
  );
}

function JobCard({
  job,
  isAvailable,
  onAccept,
  onReleased,
  onOpen,
}: {
  job: Job;
  isAvailable: boolean;
  onAccept: () => Promise<void>;
  onReleased: () => void;
  onOpen: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const acceptPending = useRef(false);
  const [acceptError, setAcceptError] = useState("");
  const vIcon = useVehicleIcon(job.vehicleClass);
  const v = VEHICLES[job.vehicleClass];

  async function handleAccept() {
    if (acceptPending.current) return;
    acceptPending.current = true;
    setAccepting(true);
    setAcceptError("");
    try {
      await onAccept();
    } catch {
      setAcceptError("Couldn’t accept this booking. Check your connection and retry.");
    } finally {
      acceptPending.current = false;
      setAccepting(false);
    }
  }

  return (
    <Card className="rd-job-card border hover:shadow-md transition flex flex-col min-w-0 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">{job.refCode}</span>
              {job.ticketId && (
                <Badge variant="outline" className="rounded-md px-2 py-0.5 font-mono text-xs border-primary/40 text-primary">
                  {job.ticketId}
                </Badge>
              )}
              <JobTypeBadge type={job.type} />
              <StatusBadge status={job.status} type={job.type === "RIDE" ? "RIDE" : "DELIVERY"} />
            </div>
            <CardTitle className="text-base mt-1.5 break-words">{job.dropoffLabel}</CardTitle>
            <CardDescription className="flex items-start gap-1 mt-0.5 break-words [&_svg]:shrink-0">
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
          <Stat label={job.paymentMethod === "CASH" ? "Cash fare" : "Rider share"} value={`₱${riderShare(job).toFixed(2)}`} icon={<Wallet className="h-4 w-4" />} />
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

        {job.assignmentExpiresAt && <p className="text-xs text-amber-700">Assigned offer — accept by {new Date(job.assignmentExpiresAt).toLocaleTimeString()}</p>}
        {acceptError && <p role="alert" className="text-xs text-destructive">{acceptError}</p>}
        {job.status === "MATCHED" && <ReleaseBooking id={job.id} onReleased={onReleased} />}
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
    <div className="space-y-0.5 min-w-0 break-words">
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
  const status = job.status;
  const [updating, setUpdating] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [pickupOtp, setPickupOtp] = useState("");
  const [pickupOtpError, setPickupOtpError] = useState<string | null>(null);

  async function advance(to: BookingStatus) {
    setUpdating(true);
    setPickupOtpError(null);
    try {
      const res = await fetch(`/api/bookings/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, ...(isRide && to === "PICKED_UP" ? { otp: pickupOtp } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setPickupOtp("");
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
      if (isRide && to === "PICKED_UP") setPickupOtpError(e instanceof Error ? e.message : "Could not verify the pickup code.");
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
  const isRide = job.type === "RIDE";
  const canAdvance = nextStatus != null && (isRide || nextStatus !== "DELIVERED");
  const nextLabel = nextStatus
    ? isRide
      ? {
          ACCEPTED: "I'm on my way",
          PICKED_UP: "Verify OTP & board",
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
    <div className="space-y-4 min-w-0 [&>*]:min-w-0">
      {/* Stepper */}
      <div className="flex items-center justify-between gap-2">
        {STATUS_STEPS.map((s) => {
          const idx = STATUS_STEPS.indexOf(s);
          const currentIdx = STATUS_STEPS.indexOf(status);
          const active = idx <= currentIdx;
          return (
            <div key={s} className="flex-1 min-w-0 flex flex-col items-center text-center">
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

      <JobRouteMap pickup={{ lat: job.pickupLat, lng: job.pickupLng }} dropoff={{ lat: job.dropoffLat, lng: job.dropoffLng }} />
      {/* Itinerary */}
      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-emerald-100 text-emerald-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium break-words">{job.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-3 border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-rose-100 text-rose-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-rose-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium break-words">{job.dropoffLabel}</p>
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
        <Stat label={job.paymentMethod === "CASH" ? "Cash fare" : "Rider share"} value={`₱${riderShare(job).toFixed(2)}`} icon={<Wallet className="h-4 w-4" />} />
        {!isRide && job.cargoNotes && (
          <div className="col-span-2 sm:col-span-3 text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 italic">
            {job.cargoNotes}
          </div>
        )}
      </div>

      <PaymentCard key={job.id} bookingId={job.id} role="RIDER" />
      {["MATCHED", "ACCEPTED"].includes(status) && <ReleaseBooking id={job.id} onReleased={() => { onClose(); onUpdated({}); }} />}

      {/* Native-app tracking ticket */}
      {job.ticketId && <TrackingTicketCard job={job} />}

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
      {isRide && status === "ACCEPTED" && (
        <Card className="border-primary/30 bg-primary/5 py-0">
          <CardContent className="space-y-3 p-4">
            <Label htmlFor={`pickup-otp-${job.id}`} className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Passenger pickup OTP</Label>
            <p className="text-sm text-muted-foreground">At pickup, ask the passenger to reveal their ride OTP. Verify it before marking them on board.</p>
            <Input id={`pickup-otp-${job.id}`} inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6-digit code" value={pickupOtp} disabled={updating} onChange={event => { setPickupOtp(event.target.value.replace(/\D/g, "").slice(0, 6)); setPickupOtpError(null); }} aria-invalid={!!pickupOtpError} className="font-mono text-lg tracking-widest" />
            {pickupOtpError && <p role="alert" className="text-sm text-destructive">{pickupOtpError}</p>}
          </CardContent>
        </Card>
      )}
      {!isDelivered ? (
        <div className="flex flex-col gap-2">
          {canAdvance && (
            <Button
              size="lg"
              onClick={() => advance(nextStatus!)}
              disabled={updating || (isRide && nextStatus === "PICKED_UP" && !/^\d{6}$/.test(pickupOtp))}
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
                Recorded fare: ₱{job.totalFare.toFixed(2)}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {showProof && (
        <ProofCapture
          bookingId={job.id}
          onDone={(completed) => {
            setShowProof(false);
            if (completed) onUpdated({ status: "DELIVERED" });
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
  onDone: (completed: boolean) => void;
}) {
  const { toast } = useToast();
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessingPhoto(true);
    try { setPhotoDataUrl(await prepareDeliveryPhoto(file)); }
    catch (error) { toast({ title: "Could not use photo", description: error instanceof Error ? error.message : "Choose another photo.", variant: "destructive" }); }
    finally { setProcessingPhoto(false); }
  }

  async function submit() {
    if (submitting || processingPhoto) return;
    setError(null);
    if (!signatureSvg && !photoDataUrl) {
      setError("Provide a recipient signature or a drop-off photo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureSvg: signatureSvg || undefined,
          photoDataUrl: photoDataUrl || undefined,
          recipientName: recipientName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Proof submission failed");
      }
      toast({
        title: "Proof of delivery captured",
        description: `${data.proofs?.length ?? 0} artifact(s) submitted.`,
      });
      onDone(Boolean(data.proofs?.some((proof: { verified: boolean }) => proof.verified)));
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
          Collect the recipient's signature to complete delivery. You can also save a drop-off photo as supporting proof.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-w-0 [&>*]:min-w-0">
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
          <p className="text-xs text-muted-foreground">Saved photos are available to authorized staff for delivery review.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={onPhotoChange}
            disabled={submitting || processingPhoto}
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
                disabled={submitting || processingPhoto}
                aria-label="Remove drop-off photo"
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
              disabled={submitting || processingPhoto}
            >
              <Upload className="h-4 w-4" /> {processingPhoto ? "Preparing photo…" : "Upload / take photo"}
            </Button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <Button className="w-full" onClick={submit} disabled={submitting || processingPhoto}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {signatureSvg ? "Submit proof & complete delivery" : "Save photo proof"}
        </Button>
      </CardContent>
    </Card>
  );
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
