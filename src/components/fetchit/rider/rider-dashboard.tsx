"use client";
import { PickupProgress } from "./pickup-progress";
import { BrowserLocation } from "./browser-location";
import type { RiderProfileData } from "../shared/rider-profile";
import { RiderAccountProfile } from "./rider-account-profile";
import { prepareDeliveryPhoto } from "@/lib/epod-photo-client";
import { demoSplit, isDemoPayment } from "@/lib/payment-policy";

// Rider dashboard — stats header, available jobs feed, active job tracker
// with ride pickup OTP verification and delivery e-POD (signature + photo).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
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
import { JobHistoryRow, JobHistorySummary } from './job-history';
import { JobPreview } from './job-preview';
import { availabilityLabel, filterHistoryJobs, isHistoryJob, jobTiming, nextJobStop, pickupCodeFeedback, type RiderJob } from '@/lib/rider-workspace';
import { ArrowLeft, SlidersHorizontal, Search } from 'lucide-react';
import "./rider-workspace.css";

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

type Job = RiderJob;

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [connected, setConnected] = useState(true);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState('ALL');
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const detailDirty = useRef(false);
  const lastJobTrigger = useRef<HTMLElement | null>(null);
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const update = () => setConnected(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [statusPending, setStatusPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<RiderStats | null>(null);
  const [tab, setTab] = useState<JobTab>("available");
  const [jobLists, setJobLists] = useState<Partial<Record<JobTab, Job[]>>>({});
  const [upcomingJobs, setUpcomingJobs] = useState<Job[]>([]);
  const [jobsCheckedAt, setJobsCheckedAt] = useState<string | null>(null);
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
      const data = await res.json();
      if (!res.ok || typeof data.isOnline !== 'boolean') throw new Error("Stats unavailable");
      if (!signal?.aborted) { setStats(data); setStatsError(''); }
    } catch { if (!signal?.aborted) setStatsError('Couldn’t check availability. Retry before changing your status.'); }
  }, []);

  const loadJobs = useCallback(async (signal?: AbortSignal) => {
    const request = ++jobsRequest.current;
    try {
      const path = tab === "available" ? "/api/rider/available?includeMatched=true" : `/api/bookings?filter=${tab}`;
      const res = await fetch(path, { cache: "no-store", signal });
      const data = await res.json().catch(()=>null);
      if (!res.ok) throw new Error(res.status===401?'Your session expired. Sign in again to refresh jobs.':res.status===403?data?.error||'Your rider account cannot access these jobs. Contact support.':'Jobs are temporarily unavailable. Please try again.');
      if (signal?.aborted || request !== jobsRequest.current) return;
      const latest = tab === "available" ? data?.jobs : data?.bookings;
      if (!Array.isArray(latest)) throw new Error("Jobs are temporarily unavailable. Please try again.");
      setJobLists(previous => ({ ...previous, [tab]: latest as Job[] }));
      if (tab === "available") setUpcomingJobs(Array.isArray(data.upcomingJobs) ? data.upcomingJobs : []);
      setJobsCheckedAt(new Date().toISOString());
      setJobErrors(previous => ({ ...previous, [tab]: undefined }));
      if (tab === "active") setActiveJob(previous => previous && !isHistoryJob(previous) ? latest.find(job => job.id === previous.id) ?? null : previous);
    } catch (error) {
      if (!signal?.aborted && request === jobsRequest.current) setJobErrors(previous => ({ ...previous, [tab]: error instanceof TypeError ? 'Couldn’t connect. Reconnect and refresh your jobs.' : error instanceof Error ? error.message : 'Couldn’t update jobs. Please try again.' }));
      throw error;
    }
  }, [tab]);

  useVisiblePoll(user ? `${user.id}:stats` : "", loadStats, 10000);

  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void loadJobs(controller.signal).catch(() => {}); });
    return () => controller.abort();
  }, [loadJobs, tab]);

  // Pause hidden/offline pages, prevent overlaps, and back off after failures.
  useVisiblePoll(tab !== "history" && user ? `${user.id}:${tab}` : "", async signal => {
    await loadJobs(signal);
  }, 3000);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/rider/profile", { signal: controller.signal, cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (data && !controller.signal.aborted) setProfile(data.profile); }).catch(() => {});
    return () => controller.abort();
  }, [user?.id, stats?.rating, stats?.completedJobs]);

  async function toggleOnline(next: boolean) {
    if (statusPending || !stats || statsError || !connected) return;
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
      throw new Error(data.error || "Couldn’t accept this request. Refresh jobs to check its availability.");
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

  const visibleHistory = filterHistoryJobs(jobs, historyQuery, historyFilter);
  const serviceText = profile?.services.map(service => service === 'RIDE' ? 'Passenger rides' : 'Delivery').join(' + ');
  const vehicleText = stats?.vehicleClass ? VEHICLES[stats.vehicleClass as keyof typeof VEHICLES]?.label ?? stats.vehicleClass : 'Your rider workspace';
  function openJob(job: Job) { lastJobTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; detailDirty.current = false; setActiveJob(job); }
  function closeJob() {
    if (detailDirty.current && !window.confirm('Leave this job screen? Unsaved pickup code or recipient signature will be discarded. Your booking is kept.')) return;
    detailDirty.current = false; setActiveJob(null);
  }
  return <div className="rd">
    <header className="rd-header"><div className="rd-header-inner">
      <button type="button" onClick={goHome} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Go to dashboard"><FetchItLogo/></button>
      <div className="rd-account">
        <OnlineToggle pending={statusPending} isOnline={stats ? stats.isOnline : null} disabled={!connected || !!statsError} onToggle={v=>void toggleOnline(v)}/>
        <ProfileMenu name={user?.name} email={user?.email} roleLabel="Rider" onViewProfile={()=>setProfileOpen(true)} onLogout={()=>void logout()}/>
      </div>
    </div></header>
    <main className="rd-main">
      <section className="rd-board-heading"><div><h1 ref={workspaceHeading} tabIndex={-1}>Your jobs</h1><p>{vehicleText}{serviceText ? ' · '+serviceText : ''}</p></div><Button variant="outline" size="sm" disabled={refreshing || !connected} onClick={()=>void refreshBoard()} aria-label="Refresh jobs"><RefreshCw size={18} className={refreshing?'animate-spin':''}/><span>Refresh</span></Button></section>
      {!connected && <div className="rd-notice" role="status">You’re offline. Saved jobs remain visible; reconnect to check availability or update a booking.</div>}
      {statsError && <div className="rd-notice" role="status"><p>{statsError}</p><Button variant="outline" size="sm" onClick={()=>void loadStats()}>Retry availability</Button></div>}
      {user && <BrowserLocation key={user.id} userId={user.id} needed={!!stats?.isOnline || (stats?.activeJobs??0)>0} availabilityKnown={!!stats}/>}
      {!!stats?.activeJobs && tab!=='active' && <button className="rd-resume" onClick={()=>setTab('active')}><Navigation size={20} aria-hidden="true"/><span><strong>Continue your active job{stats.activeJobs>1?'s':''}</strong><small>{stats.activeJobs} booking{stats.activeJobs===1?'':'s'} in progress</small></span><ArrowLeft className="rotate-180" size={18} aria-hidden="true"/></button>}
      <Tabs value={tab} onValueChange={v=>setTab(v as JobTab)}><TabsList className="rd-tabs">
        <TabsTrigger value="available"><Package size={16}/>Available <span>{jobLists.available?.length??stats?.availableJobs??'—'}</span></TabsTrigger>
        <TabsTrigger value="active"><CircleDot size={16}/>Active <span>{stats?.activeJobs??'—'}</span></TabsTrigger>
        <TabsTrigger value="history"><Clock size={16}/>History</TabsTrigger>
      </TabsList></Tabs>
      {jobsCheckedAt && <p className="rd-sync">{connected?'Last checked':'Last connected'} {new Date(jobsCheckedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})} · PH time</p>}
      {tab==='history' && <div className="rd-history-tools"><div className="rd-search"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="rider-history-search">Search booking history</label><input id="rider-history-search" type="search" placeholder="Search reference or address" value={historyQuery} onChange={event=>setHistoryQuery(event.target.value)}/></div><Button variant="outline" aria-label="Filter booking history" aria-expanded={historyFiltersOpen} aria-controls="rider-history-filters" onClick={()=>setHistoryFiltersOpen(value=>!value)}><SlidersHorizontal size={18}/>Filters{historyFilter!=='ALL'?' · 1':''}</Button>{historyFiltersOpen && <div id="rider-history-filters" className="rd-history-filters"><label>Status<select value={historyFilter} onChange={event=>setHistoryFilter(event.target.value)}><option value="ALL">All bookings</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><Button variant="ghost" onClick={()=>{setHistoryFilter('ALL');setHistoryQuery('');}}>Clear filters</Button></div>}</div>}
      {jobErrors[tab] && <div role="status" className="rd-notice"><p>{jobErrors[tab]}{jobLists[tab]?' Your current jobs remain visible.':''}</p><Button variant="outline" size="sm" onClick={()=>void loadJobs().catch(()=>{})}>Try again</Button></div>}
      {loading ? <div className="rd-jobs-grid" aria-label="Loading jobs">{[0,1].map(i=><Card key={i}><CardHeader><Skeleton className="h-6 w-40"/></CardHeader><CardContent><Skeleton className="h-20 w-full"/></CardContent></Card>)}</div>
        : jobLists[tab]===undefined ? null
        : jobs.length===0 ? <EmptyJobs tab={tab} isOnline={stats?stats.isOnline:null} onGoOnline={()=>void toggleOnline(true)}/>
        : tab==='history' ? <section className="rd-history-list" aria-label="Booking history">{visibleHistory.map(job=><JobHistoryRow key={job.id} job={job} onOpen={()=>openJob(job)}/>)}{!visibleHistory.length && <div className="rd-notice">No bookings match this search. Try another address or clear your filters.</div>}{jobs.length===100 && <p className="rd-help">Searching your 100 most recent bookings.</p>}</section>
        : <div className="rd-jobs-grid">{jobs.map(job=><JobCard key={job.id} job={job} isAvailable={tab==='available'} onOpen={()=>openJob(job)}/>)}</div>}
      {tab==='available' && upcomingJobs.length>0 && <section className="rd-upcoming" aria-labelledby="upcoming-jobs-heading"><h2 id="upcoming-jobs-heading">Upcoming · {upcomingJobs.length}</h2><p>Scheduled requests matching your vehicle and services. Acceptance opens when pickup is due.</p><div className="rd-jobs-grid">{upcomingJobs.map(job=><JobCard key={job.id} job={job} isAvailable upcoming onOpen={()=>openJob(job)}/>)}</div></section>}
      <details className="rd-day-summary"><summary><Activity size={18} aria-hidden="true"/>Your activity<ChevronDown size={18} aria-hidden="true"/></summary><div className="rd-stats">
        <StatCard icon={<Activity size={20}/>} label="Active jobs" value={stats?.activeJobs??0} loading={!stats}/>
        <StatCard icon={<CheckCircle2 size={20}/>} label="Completed" value={stats?.completedJobs??0} loading={!stats}/>
        <StatCard icon={<Star size={20}/>} label="Customer rating" value={profile?.ratingCount?(profile.rating??0).toFixed(1):'No ratings yet'} loading={!stats}/>
        <StatCard icon={<Wallet size={20}/>} label="Completed cash fares" value={'₱'+(stats?.earnings??0).toFixed(2)} loading={!stats}/>
      </div>{!!stats && (stats.demoEarnings>0||stats.demoAwaitingPayout>0||stats.demoPaidOut>0) && <div className="rd-notice"><p>Online test transactions · no money transferred</p><p>Earned ₱{stats.demoEarnings.toFixed(2)} · Awaiting review ₱{stats.demoAwaitingPayout.toFixed(2)} · Payouts ₱{stats.demoPaidOut.toFixed(2)}</p></div>}</details>
    </main>
    <RiderAccountProfile open={profileOpen} onOpenChange={setProfileOpen}/>
    <Dialog open={!!activeJob} onOpenChange={open=>{if(!open)closeJob();}}><DialogContent className="rd-job-screen" showCloseButton={false} onCloseAutoFocus={event=>{event.preventDefault();(lastJobTrigger.current?.isConnected?lastJobTrigger.current:workspaceHeading.current)?.focus({preventScroll:true});}}>
      {activeJob && <><div className="rd-job-screen-heading"><Button variant="ghost" onClick={closeJob} aria-label="Back to jobs"><ArrowLeft size={20}/><span>Back</span></Button><DialogHeader><DialogTitle>{isHistoryJob(activeJob)?'Booking summary': ['PENDING','MATCHED'].includes(activeJob.status)?'Review request':'Current job'} · {activeJob.refCode}</DialogTitle><DialogDescription>{statusLabel(activeJob.status,activeJob.type==='RIDE'?'RIDE':'DELIVERY')}</DialogDescription></DialogHeader></div>
        {isHistoryJob(activeJob)?<JobHistorySummary key={activeJob.id} job={activeJob} offline={!connected}/>:['PENDING','MATCHED'].includes(activeJob.status)?<JobPreview key={activeJob.id} job={activeJob} acceptanceBlock={!connected ? "Reconnect to accept this request." : !stats || statsError ? "Check your availability before accepting." : activeJob.status === "PENDING" && stats.activeJobs > 0 ? "Finish your active booking before accepting another request." : undefined} onAccept={()=>accept(activeJob)} onReleased={()=>{setActiveJob(null);void refreshBoard();}}/>
          : <ActiveJobFlow key={activeJob.id} job={activeJob} onDraftChange={dirty=>{detailDirty.current=dirty;}} onUpdated={updated=>{setActiveJob(previous=>previous?{...previous,...updated}:previous);void loadJobs().catch(()=>{});void loadStats();}} onClose={closeJob}/>}</>}
    </DialogContent></Dialog>
    <footer className="rd-footer">Fetch-It Rider · Your next move starts here.</footer>
  </div>;
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
  disabled = false,
  onToggle,
}: {
  pending: boolean;
  isOnline: boolean | null;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      variant={isOnline ? "default" : "outline"}
      size="sm"
      onClick={() => onToggle(!isOnline)}
      disabled={pending || disabled || isOnline === null}
      aria-label={availabilityLabel(isOnline, pending)}
      className={cn("rd-online-toggle", isOnline && "is-online")}
    >
      <PowerCircle className={cn("h-4 w-4", isOnline ? "text-emerald-500" : "text-muted-foreground")} />
      {isOnline === null ? 'Checking…' : availabilityLabel(isOnline, pending)}
    </Button>
  );
}

function EmptyJobs({
  tab,
  isOnline,
  onGoOnline,
}: {
  tab: "available" | "active" | "history";
  isOnline: boolean | null;
  onGoOnline: () => void;
}) {
  if (tab === "history") {
    return (
      <Card className="rd-empty border-2 border-dashed bg-card">
        <CardContent className="py-16 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-muted grid place-items-center mb-4">
            <Clock className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg">No booking history yet</h3>
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
          {tab === "available" ? isOnline===null?'Checking your workspace…':"No jobs available right now" : "No active jobs"}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          {tab === "available"
            ? isOnline === null ? "Checking your availability. Please wait…" : isOnline
              ? "No matching requests right now. New jobs for your vehicle and approved services appear automatically."
              : "You're offline — go online to start receiving job matches."
            : "Accept a job from the Available tab to start driving."}
        </p>
        {tab === "available" && isOnline === false && (
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

function JobCard({ job, isAvailable, upcoming = false, onOpen }: { job: Job; isAvailable: boolean; upcoming?: boolean; onOpen: () => void }) {
  const timing=jobTiming(job), stop=nextJobStop(job);
  return <Card className="rd-job-card">
    <CardHeader><div className="rd-card-meta"><JobTypeBadge type={job.type}/><span>{job.refCode}</span>{upcoming?<Badge variant="outline">Scheduled</Badge>:<StatusBadge status={job.status} type={job.type==='RIDE'?'RIDE':'DELIVERY'}/>}</div></CardHeader>
    <CardContent><dl className="rd-itinerary"><div><dt>Pickup</dt><dd>{job.pickupLabel}</dd></div><div><dt>Drop-off</dt><dd>{job.dropoffLabel}</dd></div></dl>
      <div className="rd-card-facts"><strong>₱{riderShare(job).toFixed(2)}<small>{job.paymentMethod==='CASH'?'Cash fare':'Rider share'}</small></strong><span>{job.distanceKm} km</span><span>{job.type==='RIDE'?(job.passengers??1)+' passenger(s)':job.cargoWeightKg+' kg'}</span></div>
      {isAvailable && <p className={'rd-timing is-'+timing.kind}><Clock size={15} aria-hidden="true"/>{timing.label}</p>}
      {!isAvailable && <p className="rd-help">Next: {stop.label.toLowerCase()}</p>}
      <Button variant={upcoming?'outline':'default'} className="w-full" onClick={onOpen}><Navigation size={17} aria-hidden="true"/>{isAvailable?'View route & details':'Continue job'}</Button>
    </CardContent>
  </Card>;
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
  onDraftChange,
}: {
  job: Job;
  onUpdated: (u: Partial<Job>) => void;
  onClose: () => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { toast } = useToast();
  const status = job.status;
  const [updating, setUpdating] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [pickupOtp, setPickupOtp] = useState("");
  const [pickupOtpError, setPickupOtpError] = useState<string | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [proofState, setProofState] = useState({ busy: false, hasSignature: false });
  const paymentSection=useRef<HTMLDivElement>(null), proofSection=useRef<HTMLDivElement>(null), pickupInput=useRef<HTMLInputElement>(null);
  const draftCallback=useRef(onDraftChange);
  useEffect(()=>{draftCallback.current=onDraftChange;},[onDraftChange]);
  useEffect(()=>{draftCallback.current(!!pickupOtp || showProof);return()=>draftCallback.current(false);},[pickupOtp,showProof]);
  useEffect(()=>{if(showProof)proofSection.current?.scrollIntoView({block:'start',behavior:'smooth'});},[showProof]);

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
      if (isRide && to === "PICKED_UP") { setPickupOtpError(pickupCodeFeedback(e instanceof Error ? e.message : "Could not verify the pickup code.")); return; }
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
          PICKED_UP: "Verify pickup code",
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
    <div className="rd-flow"><div className="rd-flow-body space-y-4">
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

      <div className="rd-current-stop"><p>Next stop · {nextJobStop(job).label}</p><strong>{nextJobStop(job).address}</strong></div>
      {isRide && status === "ACCEPTED" && <PickupProgress key={job.id} bookingId={job.id} />}
      <JobRouteMap pickup={{ lat: job.pickupLat, lng: job.pickupLng }} dropoff={{ lat: job.dropoffLat, lng: job.dropoffLng }} navigation={nextJobStop(job).navigation}/>
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

      <div ref={paymentSection} tabIndex={-1}><details className="rd-details" open={status === 'IN_TRANSIT'}><summary>Payment details<ChevronDown size={16} aria-hidden="true"/></summary><PaymentCard key={`${job.id}:${status}`} bookingId={job.id} role="RIDER" onPaymentReady={setPaymentReady} /></details></div>
      {["MATCHED", "ACCEPTED"].includes(status) && <ReleaseBooking id={job.id} onReleased={() => { onClose(); onUpdated({}); }} />}

      {/* Native-app tracking ticket */}
      {job.ticketId && <details className="rd-details"><summary>Optional tracking ticket<ChevronDown size={16} aria-hidden="true"/></summary><TrackingTicketCard job={job}/></details>}

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
          <a className="rd-call" href={`tel:${job.customer.phone}`} aria-label="Call customer"><Phone size={18} aria-hidden="true"/>Call customer</a>
        )}
      </div>

      {/* Action buttons */}
      {isRide && status === "ACCEPTED" && (
        <Card className="border-primary/30 bg-primary/5 py-0">
          <CardContent className="space-y-3 p-4">
            <Label htmlFor={`pickup-otp-${job.id}`} className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Passenger pickup code</Label>
            <p className="text-sm text-muted-foreground">At pickup, ask the passenger for their six-digit code. Verification confirms the passenger is on board.</p>
            <Input ref={pickupInput} id={`pickup-otp-${job.id}`} inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6-digit code" value={pickupOtp} disabled={updating} onChange={event => { setPickupOtp(event.target.value.replace(/\D/g, "").slice(0, 6)); setPickupOtpError(null); }} aria-invalid={!!pickupOtpError} className="font-mono text-lg tracking-widest" />
            {pickupOtpError && <p role="alert" className="text-sm text-destructive">{pickupOtpError}</p>}
          </CardContent>
        </Card>
      )}

      {showProof && (job.paymentMethod !== "CASH" || paymentReady) && (
        <div ref={proofSection}><ProofCapture
          bookingId={job.id}
          onProofState={setProofState}
          onDone={(completed) => {
            setShowProof(false);
            if (completed) onUpdated({ status: "DELIVERED" });
            void loadStatsThroughReload(onUpdated, job.id);
          }}
        /></div>
      )}

      </div>
            {!isDelivered ? (
        <div className="rd-flow-actions">
          {isRide && status === 'ACCEPTED' && !pickupOtp && <Button variant="outline" onClick={()=>{pickupInput.current?.scrollIntoView({block:'center'});pickupInput.current?.focus({preventScroll:true});}}>Enter passenger pickup code</Button>}
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
          {status === 'IN_TRANSIT' && !isRide && job.paymentMethod === 'CASH' && !paymentReady && <><p className="rd-help">Confirm arrival and cash payment before collecting the recipient signature.</p><Button variant="outline" onClick={()=>{paymentSection.current?.scrollIntoView({block:'start',behavior:'smooth'});paymentSection.current?.focus({preventScroll:true});}}>Review payment steps</Button></>}
          {status === "IN_TRANSIT" && !isRide && !showProof && (
            <Button
              size="lg"
              onClick={() => { if (!showProof || window.confirm('Discard the unsaved recipient signature? Your booking is kept.')) setShowProof(value => !value); }}
              disabled={updating || (job.paymentMethod === "CASH" && !paymentReady)}
            >
              <ShieldCheck className="h-4 w-4" /> Get recipient signature
            </Button>
          )}
          {showProof && <><Button type="submit" form={`delivery-proof-${job.id}`} disabled={proofState.busy || updating}>{proofState.busy ? 'Saving…' : proofState.hasSignature ? 'Complete delivery' : 'Save supporting proof'}</Button><Button variant="ghost" disabled={proofState.busy} onClick={()=>{if(window.confirm('Discard unsaved proof details? Your booking is kept.'))setShowProof(false);}}>Cancel signature</Button></>}
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

      {isDelivered && <div className="rd-flow-actions"><Button onClick={onClose}>Back to jobs</Button></div>}
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
  onProofState,
}: {
  bookingId: string;
  onDone: (completed: boolean) => void;
  onProofState: (state: { busy: boolean; hasSignature: boolean }) => void;
}) {
  const { toast } = useToast();
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const proofPending = useRef(false);
  useEffect(()=>{onProofState({busy:submitting || processingPhoto,hasSignature:!!signatureSvg});},[submitting,processingPhoto,signatureSvg,onProofState]);

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
    if (proofPending.current || submitting || processingPhoto) return;
    setError(null);
    if (!signatureSvg && !photoDataUrl) {
      setError("Provide a recipient signature or a drop-off photo.");
      return;
    }
    proofPending.current = true;
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
      toast({title:data.proofs?.some((proof:{verified:boolean})=>proof.verified)?'Delivery completed':'Supporting proof saved',description:'Your booking has been updated.'});
      onDone(Boolean(data.proofs?.some((proof: { verified: boolean }) => proof.verified)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      proofPending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Recipient confirmation
        </CardTitle>
        <CardDescription>
          Collect the recipient's signature to complete delivery. You can also save a drop-off photo as supporting proof.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 min-w-0 [&>*]:min-w-0">
        <form id={`delivery-proof-${bookingId}`} className="space-y-4" onSubmit={event=>{event.preventDefault();void submit();}}>
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
                type="button"
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

        <p className="rd-help">Your recipient signature completes the delivery. Use the action below when ready.</p>
        </form>
      </CardContent>
    </Card>
  );
}
