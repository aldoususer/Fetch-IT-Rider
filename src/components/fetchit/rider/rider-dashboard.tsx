"use client";
import { startBookingTiming } from "@/lib/booking-client-timing";
import { readProofDraft, removeProofDraft, retainActiveProofDrafts } from '@/lib/proof-drafts';
import { savedMutation } from "@/lib/booking-mutation-client";
import { GoOnlineDialog } from './go-online-dialog';
import { OfferCountdown } from './offer-countdown';
import { acceptRiderBooking, type AcceptancePhase } from '@/lib/rider-acceptance-client';
import { rememberRiderLocation, type RiderFix } from '@/lib/rider-location-client';
import { useRiderNavigation } from "@/hooks/use-rider-navigation";
import { useBookingRecovery } from "@/hooks/use-booking-recovery";
import { useRiderAlerts } from "@/hooks/use-rider-alerts";
import { RiderNotifications } from "./rider-notifications";
import type { RiderAlert } from "@/lib/rider-alerts";
import { PickupProgress } from "./pickup-progress";
import { PickupQrScanner } from "./pickup-qr-scanner";
import { BrowserLocation } from "./browser-location";
import type { RiderProfileData } from "../shared/rider-profile";
import { RiderAccountProfile } from "./rider-account-profile";
import { SlowRequestFeedback } from "../shared/slow-request-feedback";
import { ProofCapture, type ProofState } from "./proof-capture";
import { riderEarningsForBooking } from "@/lib/fare-policy";

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
  KeyRound,
  Wallet,
  PowerCircle,
  Activity,
  RefreshCw,
  ChevronDown,
  X,
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
import { ProfileMenu } from "../shared/profile-menu";
import { JobHistoryRow, JobHistorySummary } from './job-history';
import { JobPreview } from './job-preview';
import { availabilityLabel, filterHistoryJobs, isHistoryJob, jobTiming, nextJobStop, pickupCodeFeedback, mergeRiderJob, type RiderJob } from '@/lib/rider-workspace';
import { ArrowLeft, SlidersHorizontal, Search } from 'lucide-react';
import "./rider-workspace.css";

interface RiderStats {
  activeJobs: number;
  offeredJobs?: number;
  completedJobs: number;
  availableJobs: number;
  rating: number;
  totalDeliveries: number;
  isOnline: boolean;
  trackingRequired?: boolean;
  matchingReady?: boolean;
  matchingPauseReason?: string;
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
  return riderEarningsForBooking(job);
}

export function RiderDashboard() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const refreshUser = useAppStore((s) => s.refreshUser);
  const { toast } = useToast();

  const alerts = useRiderAlerts(user?.id ?? "");
  const statusLock = useRef(false);
  const [onlineSetupOpen, setOnlineSetupOpen] = useState(false);
  const [profile, setProfile] = useState<RiderProfileData | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [connected, setConnected] = useState(true);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState('ALL');
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const detailDirty = useRef(false);
  const navigationRequest = useRef(0);
  const knownJobs = useRef(new Map<string, Job>());
  const restoreScroll = useRef<number | null>(null);
  const earningsRequested = useRef(false);
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
  useEffect(() => {
    if (user?.id && activeJob && (isHistoryJob(activeJob) || activeJob.riderId !== user.id)) void removeProofDraft(user.id, activeJob.id).catch(() => {});
  }, [user?.id, activeJob?.id, activeJob?.status, activeJob?.riderId]);
  const jobsRequest = useRef(0);
  const statsRequest = useRef(0);
  const statsActiveCount = useRef<number | null>(null);
  const jobs = jobLists[tab] ?? [];
  // Only a tab's first load uses skeletons. Refreshes preserve its existing
  // cards and their mounted state, including any open job actions.
  const loading = jobLists[tab] === undefined && !jobErrors[tab];

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    const request = ++statsRequest.current;
    try {
      const res = await fetch("/api/rider/stats", { cache: "no-store", signal });
      const data = await res.json();
      if (!res.ok || typeof data.isOnline !== 'boolean') throw new Error("Stats unavailable");
      if (!signal?.aborted && request === statsRequest.current) { statsActiveCount.current = data.activeJobs; setStats(data); setStatsError(''); }
    } catch { if (!signal?.aborted && request === statsRequest.current) setStatsError('Couldn’t check availability. Retry before changing your status.'); }
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
      if (tab === "active") {
        if (user?.id && latest.length < 100) void retainActiveProofDrafts(user.id, latest).catch(() => {});
        // The active feed is fresher than a slower stats request. Update the
        // count with the cards and discard any older stats response in flight.
        const count = latest.filter(job => ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status)).length;
        if (statsActiveCount.current !== null && statsActiveCount.current !== count) {
          statsRequest.current++; statsActiveCount.current = count;
          setStats(previous => previous ? { ...previous, activeJobs: count } : previous);
        }
      }
      if (tab === "active") setActiveJob(previous => {
        if (!previous || isHistoryJob(previous)) return previous;
        const incoming = latest.find(job => job.id === previous.id);
        return incoming ? mergeRiderJob(previous, incoming) : null;
      });
    } catch (error) {
      if (!signal?.aborted && request === jobsRequest.current) setJobErrors(previous => ({ ...previous, [tab]: error instanceof TypeError ? 'Couldn’t connect. Reconnect and refresh your jobs.' : error instanceof Error ? error.message : 'Couldn’t update jobs. Please try again.' }));
      throw error;
    }
  }, [tab, user?.id]);

  useVisiblePoll(user ? `${user.id}:stats` : "", loadStats, 10000);

  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void loadJobs(controller.signal).catch(() => {}); });
    return () => controller.abort();
  }, [loadJobs, tab]);

  // Pause hidden/offline pages, prevent overlaps, and back off after failures.
  const boardConnection = useVisiblePoll(tab !== "history" && user ? `${user.id}:${tab}` : "", async signal => {
    await loadJobs(signal);
  }, 3000);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/rider/profile", { signal: controller.signal, cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (data && !controller.signal.aborted) setProfile(data.profile); }).catch(() => {});
    return () => controller.abort();
  }, [user?.id, stats?.rating, stats?.completedJobs]);

  async function toggleOnline(next: boolean, location?: RiderFix, inlineFeedback = false) {
    if (statusLock.current || statusPending || !stats || (next && statsError) || !connected) {
      if (location || inlineFeedback) throw new Error('Couldn’t update availability. Check your connection and retry.');
      return;
    }
    if (next && !location) { setOnlineSetupOpen(true); return; }
    statusLock.current = true; setStatusPending(true);
    try {
      const res = await fetch("/api/rider/status", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ online: next, ...(next ? { location, notificationPermission: Notification.permission } : {}) }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.isOnline !== 'boolean') throw new Error(data?.error || "Couldn’t confirm your availability. Refresh to check your status before retrying.");
      statsRequest.current++; if (data.isOnline && location && user) rememberRiderLocation(user.id, location);
      setStats(previous => previous ? { ...previous, isOnline: data.isOnline, matchingReady: data.isOnline } : previous);
      void refreshUser().catch(() => {});
      toast({ title: data.isOnline ? "You're online" : "You're offline", description: data.isOnline ? "Nearby offers and open requests appear in Available." : "Go online again when you're ready for jobs." });
      if (data.isOnline) void loadJobs().catch(() => {});
    } catch (error) {
      const message = error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Couldn’t confirm your availability. Refresh to check your status before retrying.';
      if (next || inlineFeedback) throw new Error(message);
      toast({ title: "Availability not confirmed", description: message, variant: "destructive" });
    }
    finally { statusLock.current = false; setStatusPending(false); }
  }
  async function refreshBoard() {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([loadJobs(), loadStats()]); } catch { /* Existing board retry message handles failed refreshes. */ }
    finally { setRefreshing(false); }
  }

  async function accept(job: Job, onPhase?: (phase: AcceptancePhase) => void) {
    if (!user) throw new Error('Please sign in again.');
    const data = { booking: await acceptRiderBooking(job.id, user.id, onPhase) };
    jobsRequest.current++;
    toast({ title: "Job accepted", description: job.refCode });
    setJobLists(previous => ({ ...previous,
      available: previous.available?.filter(item => item.id !== job.id),
      active: [data.booking, ...(previous.active ?? []).filter(item => item.id !== job.id)],
    }));
    knownJobs.current.set(job.id, data.booking);
    setActiveJob(data.booking);
    navigation.navigate("active", job.id, true);
    void loadStats();
  }

  // Clicking the logo always brings you back to the main dashboard view.
  function goHome() {
    navigation.navigate("available");
  }

  async function openNotification(item: Pick<RiderAlert, 'bookingId'>, restoring = false) {
    if (!restoring && !canLeaveJob()) throw new Error('Your current job is still open.');
    const request = ++navigationRequest.current;
    const response = await fetch('/api/bookings/' + encodeURIComponent(item.bookingId), { cache: 'no-store' });
    let booking: Job | undefined;
    if (response.ok) booking = (await response.json()).booking;
    else if (response.status === 403) {
      const feed = await fetch('/api/rider/available?includeMatched=true', { cache: 'no-store' });
      if (feed.ok) { const data = await feed.json(); booking = [...(data.jobs ?? []), ...(data.upcomingJobs ?? [])].find(job => job.id === item.bookingId); }
    }
    if (!booking) throw new Error('This request is no longer available. Refresh jobs for current requests.');
    if (request !== navigationRequest.current) return;
    knownJobs.current.set(booking.id, booking);
    if (restoring) { setActiveJob(booking); return; }
    openJob(booking);
  }
  const notificationOpen = useRef(openNotification);
  useEffect(() => { notificationOpen.current = openNotification; });
  useEffect(() => {
    const open = (id: unknown) => {
      if (typeof id === 'string' && id.length <= 100) void notificationOpen.current({ bookingId: id }).catch(error => toast({ title: 'Booking unavailable', description: error instanceof Error ? error.message : 'Refresh jobs for current requests.' }));
    };
    const message = (event: MessageEvent) => { if (event.data?.type === 'RIDER_NOTIFICATION') open(event.data.bookingId); };
    navigator.serviceWorker?.addEventListener('message', message);
    return () => navigator.serviceWorker?.removeEventListener('message', message);
  }, [user?.id, toast]);
  const reconnecting = boardConnection.status === 'reconnecting' || alerts.connection.status === 'reconnecting';
  const boardIssue = !connected ? 'No internet connection. Job statuses may be out of date. Reconnect before updating a booking.' : jobErrors[tab] || statsError || (reconnecting ? 'Reconnecting to Fetch-It… Existing job details remain visible while we check for updates.' : '');
  const visibleHistory = filterHistoryJobs(jobs, historyQuery, historyFilter);
  const serviceText = profile?.services.map(service => service === 'RIDE' ? 'Passenger rides' : 'Delivery').join(' + ');
  const vehicleText = stats?.vehicleClass ? VEHICLES[stats.vehicleClass as keyof typeof VEHICLES]?.label ?? stats.vehicleClass : 'Your rider workspace';
  function canLeaveJob() {
    if (detailDirty.current && !window.confirm('Leave this job? Your pickup code or proof details that have not finished saving will be lost. Your booking is kept.')) return false;
    detailDirty.current = false; return true;
  }
  const navigation = useRiderNavigation(user?.id ?? '', state => {
    navigationRequest.current++; setTab(state.tab); restoreScroll.current = state.scrollY;
    if (!state.jobId) { setActiveJob(null); return; }
    const cached = knownJobs.current.get(state.jobId) ?? Object.values(jobLists).flat().find(job => job?.id === state.jobId);
    if (cached) setActiveJob(cached);
    void notificationOpen.current({ bookingId: state.jobId }, true).catch(error => {
      toast({ title: 'Booking unavailable', description: error.message }); navigation.close();
    });
  }, canLeaveJob);
  useEffect(() => {
    if (activeJob) return;
    if (earningsRequested.current) {
      restoreScroll.current = null;
      const frame = requestAnimationFrame(() => {
        const activity = document.getElementById('rider-activity') as HTMLDetailsElement | null;
        if (activity) { activity.open = true; activity.scrollIntoView({block:'start',behavior:'smooth'}); activity.focus({preventScroll:true}); }
        earningsRequested.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (jobLists[tab] === undefined || restoreScroll.current === null) return;
    const top = restoreScroll.current; restoreScroll.current = null;
    const frame = requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [activeJob, jobLists, tab]);
  function openJob(job: Job) {
    lastJobTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    knownJobs.current.set(job.id, job);
    navigation.navigate(isHistoryJob(job) ? 'history' : ['PENDING', 'MATCHED'].includes(job.status) ? 'available' : 'active', job.id);
  }
  function closeJob() { navigation.close(); }
  const deviceNotificationsReady = alerts.browserEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const matchingReady = stats?.matchingReady === true && deviceNotificationsReady && connected && !statsError;
  const paused = !!stats?.isOnline && !matchingReady && !stats.activeJobs && !stats.offeredJobs;
  const pauseReason = !connected ? 'Reconnect to receive new offers.' : statsError || (!alerts.settingsLoading && !deviceNotificationsReady ? 'Enable notifications on this device to receive new offers.' : stats?.matchingPauseReason) || 'Refresh your location to receive new offers.';
  return <div className="rd">
    <header className="rd-header"><div className="rd-header-inner">
      <button type="button" onClick={goHome} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Go to dashboard"><FetchItLogo/></button>
      <div className="rd-account">
        <OnlineToggle pending={statusPending} matchingReady={matchingReady} activeJobs={stats?.activeJobs ?? 0} offeredJobs={stats?.offeredJobs ?? 0} onResume={()=>setOnlineSetupOpen(true)} isOnline={stats ? stats.isOnline : null} disabled={!connected || (!!statsError && !stats?.isOnline)} onToggle={v=>void toggleOnline(v)}/>
        <RiderNotifications alerts={alerts} onOpen={openNotification}/>
        <ProfileMenu name={user?.name} email={user?.email} roleLabel="Rider" onViewProfile={()=>setProfileOpen(true)} onLogout={()=>void logout()}/>
      </div>
    </div></header>
    <main className="rd-main">
      <section className="rd-board-heading"><div><h1 ref={workspaceHeading} tabIndex={-1}>Your jobs</h1><p>{vehicleText}{serviceText ? ' · '+serviceText : ''}</p></div><Button variant="outline" size="sm" disabled={refreshing || !connected} onClick={()=>void refreshBoard()} aria-label="Refresh jobs"><RefreshCw size={18} className={refreshing?'animate-spin':''}/><span>Refresh</span></Button></section>
      {boardIssue && <div className="rd-notice" role="status"><p>{boardIssue}</p><Button variant="outline" disabled={!connected || refreshing} onClick={()=>void refreshBoard()}>Retry connection</Button></div>}
      {tab === 'available' && paused && (loading || jobs.length > 0) && <div className="rd-notice" role="status"><p>{pauseReason}</p><Button variant="outline" onClick={()=>setOnlineSetupOpen(true)}>Resume receiving jobs</Button></div>}
      {user && <div hidden={tab === 'history'}><BrowserLocation key={user.id} userId={user.id} needed={!!stats?.isOnline || !!stats?.trackingRequired} availabilityKnown={!!stats}/></div>}
      {!!stats?.activeJobs && tab!=='active' && <button className="rd-resume" onClick={()=>navigation.navigate('active')}><Navigation size={20} aria-hidden="true"/><span><strong>Continue your active job{stats.activeJobs>1?'s':''}</strong><small>{stats.activeJobs} booking{stats.activeJobs===1?'':'s'} in progress</small></span><ArrowLeft className="rotate-180" size={18} aria-hidden="true"/></button>}
      <Tabs value={tab} onValueChange={v=>navigation.navigate(v as JobTab)}><TabsList className="rd-tabs">
        <TabsTrigger value="available"><Package size={20}/><span className="rd-tab-label">Available <span className="rd-tab-count">{jobLists.available?.length??stats?.availableJobs??'—'}</span></span></TabsTrigger>
        <TabsTrigger value="active"><CircleDot size={20}/><span className="rd-tab-label">Active <span className="rd-tab-count">{stats?.activeJobs??'—'}</span></span></TabsTrigger>
        <TabsTrigger value="history"><Clock size={20}/><span className="rd-tab-label">History</span></TabsTrigger>
      </TabsList></Tabs>
      {jobsCheckedAt && <p className="rd-sync" title={jobsCheckedAt ? `Last checked ${new Date(jobsCheckedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})} · PH time` : undefined}>{connected && !reconnecting ? 'Updated '+new Date(jobsCheckedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}) : 'Last confirmed '+new Date(jobsCheckedAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})+' · Updates paused'}</p>}
      {tab==='history' && <div className="rd-history-tools"><div className="rd-search"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="rider-history-search">Search booking history</label><input id="rider-history-search" type="search" placeholder="Search reference or address" value={historyQuery} onChange={event=>setHistoryQuery(event.target.value)}/></div><Button variant="outline" aria-label="Filter booking history" aria-expanded={historyFiltersOpen} aria-controls="rider-history-filters" onClick={()=>setHistoryFiltersOpen(value=>!value)}><SlidersHorizontal size={18}/>Filters{historyFilter!=='ALL'?' · 1':''}</Button>{historyFiltersOpen && <div id="rider-history-filters" className="rd-history-filters"><label>Status<select value={historyFilter} onChange={event=>setHistoryFilter(event.target.value)}><option value="ALL">All bookings</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><Button variant="ghost" onClick={()=>{setHistoryFilter('ALL');setHistoryQuery('');}}>Clear filters</Button></div>}</div>}
      {loading ? <div className="rd-jobs-grid" aria-label="Loading jobs">{[0,1].map(i=><Card key={i}><CardHeader><Skeleton className="h-6 w-40"/></CardHeader><CardContent><Skeleton className="h-20 w-full"/></CardContent></Card>)}</div>
        : jobLists[tab]===undefined ? null
        : jobs.length===0 ? <EmptyJobs connected={connected} onFindJobs={()=>navigation.navigate("available")} onActiveJobs={()=>navigation.navigate("active")} tab={tab} isOnline={stats?stats.isOnline:null} paused={paused} activeJobs={stats?.activeJobs ?? 0} pauseReason={pauseReason} onGoOnline={()=>void toggleOnline(true)} onResume={()=>setOnlineSetupOpen(true)}/>
        : tab==='history' ? <section className="rd-history-list" aria-label="Booking history">{visibleHistory.map(job=><JobHistoryRow key={job.id} job={job} onOpen={()=>openJob(job)}/>)}{!visibleHistory.length && <div className="rd-notice"><p>No bookings match this search. Try another address or clear your filters.</p><Button variant="outline" className="min-h-12" onClick={()=>{setHistoryFilter("ALL");setHistoryQuery("");}}>Clear filters</Button></div>}{jobs.length===100 && <p className="rd-help">Searching your 100 most recent bookings.</p>}</section>
        : tab==='available' ? <>{jobs.some(job=>job.status==='MATCHED') && <section className="rd-offers" aria-labelledby="rider-offers-heading"><h2 id="rider-offers-heading">Offered to you</h2><p>Exclusive offers. Accept or decline before the timer ends.</p><div className="rd-jobs-grid">{jobs.filter(job=>job.status==='MATCHED').map(job=><div key={job.id}><OfferCountdown expiresAt={job.assignmentExpiresAt}/><JobCard job={job} isAvailable onOpen={()=>openJob(job)}/></div>)}</div></section>}{jobs.some(job=>job.status==='PENDING') && <section className="rd-open-requests" aria-labelledby="open-requests-heading"><h2 id="open-requests-heading">Open requests</h2><p>Choose a request that fits your trip.</p><div className="rd-jobs-grid">{jobs.filter(job=>job.status==='PENDING').map(job=><JobCard key={job.id} job={job} isAvailable onOpen={()=>openJob(job)}/>)}</div></section>}</> : <div className="rd-jobs-grid">{jobs.map(job=><JobCard key={job.id} job={job} isAvailable={false} onOpen={()=>openJob(job)}/>)}</div>}
      {tab==='available' && upcomingJobs.length>0 && <section className="rd-upcoming" aria-labelledby="upcoming-jobs-heading"><h2 id="upcoming-jobs-heading">Upcoming · {upcomingJobs.length}</h2><p>Scheduled requests matching your vehicle and services. Acceptance opens when pickup is due.</p><div className="rd-jobs-grid">{upcomingJobs.map(job=><JobCard key={job.id} job={job} isAvailable upcoming onOpen={()=>openJob(job)}/>)}</div></section>}
      <details id="rider-activity" tabIndex={-1} className="rd-day-summary"><summary><Activity size={18} aria-hidden="true"/>Your activity<ChevronDown size={18} aria-hidden="true"/></summary><div className="rd-stats">
        <StatCard icon={<Activity size={20}/>} label="Active jobs" value={stats?.activeJobs??0} loading={!stats}/>
        <StatCard icon={<CheckCircle2 size={20}/>} label="Completed" value={stats?.completedJobs??0} loading={!stats}/>
        <StatCard onClick={() => setProfileOpen(true)} icon={<Star size={20}/>} label="Customer rating" value={profile?.ratingCount?(profile.rating??0).toFixed(1):'No ratings yet'} loading={!stats}/>
        <StatCard icon={<Wallet size={20}/>} label="Completed cash fares" value={'₱'+(stats?.earnings??0).toFixed(2)} loading={!stats}/>
      </div>{!!stats && (stats.demoEarnings>0||stats.demoAwaitingPayout>0||stats.demoPaidOut>0) && <div className="rd-notice"><p>Online test transactions · no money transferred</p><p>Earned ₱{stats.demoEarnings.toFixed(2)} · Awaiting review ₱{stats.demoAwaitingPayout.toFixed(2)} · Payouts ₱{stats.demoPaidOut.toFixed(2)}</p></div>}</details>
    </main>
    {onlineSetupOpen && <GoOnlineDialog open onOpenChange={setOnlineSetupOpen} isOnline={!!stats?.isOnline} onGoOffline={()=>toggleOnline(false, undefined, true)} notificationsReady={deviceNotificationsReady} enableNotifications={alerts.enableBrowser} onReady={async fix=>{await toggleOnline(true,fix);void loadStats();}}/>}
    <RiderAccountProfile showReviews open={profileOpen} onOpenChange={setProfileOpen}/>
    <Dialog open={!!activeJob} onOpenChange={open=>{if(!open)closeJob();}}><DialogContent fullScreenOnMobile className="rd-job-screen" showCloseButton={false} onCloseAutoFocus={event=>{event.preventDefault();if(earningsRequested.current)return;(lastJobTrigger.current?.isConnected?lastJobTrigger.current:workspaceHeading.current)?.focus({preventScroll:true});}}>
      {activeJob && <><div className="rd-job-screen-heading"><Button variant="ghost" onClick={closeJob} aria-label="Back to jobs"><ArrowLeft size={20}/><span>Back</span></Button><DialogHeader><DialogTitle>{isHistoryJob(activeJob)?'Booking summary': ['PENDING','MATCHED'].includes(activeJob.status)?'Review request':'Current job'} · {activeJob.refCode}</DialogTitle><DialogDescription>{activeJob.status === 'PENDING' ? 'New request' : statusLabel(activeJob.status,activeJob.type==='RIDE'?'RIDE':'DELIVERY')}</DialogDescription></DialogHeader></div>
        {isHistoryJob(activeJob)?<JobHistorySummary key={activeJob.id} job={activeJob} offline={!connected} onBack={closeJob} onEarnings={()=>{earningsRequested.current=true;navigation.navigate(tab,null,true);}}/>:['PENDING','MATCHED'].includes(activeJob.status)?<JobPreview key={activeJob.id} job={activeJob} acceptanceBlock={!connected ? "Reconnect to accept this request." : boardConnection.status !== "connected" ? "Checking current job availability. Wait for the connection to recover." : !stats || statsError ? "Check your availability before accepting." : activeJob.status === "PENDING" && (stats.offeredJobs??0)>0 ? "Accept or decline your exclusive offer before choosing another request." : activeJob.status === "PENDING" && stats.activeJobs > 0 ? "Finish your active booking before accepting another request." : undefined} onAccept={onPhase=>accept(activeJob,onPhase)} onReleased={()=>{navigation.navigate(tab,null,true);void refreshBoard();}}/>
          : <ActiveJobFlow key={activeJob.id} job={activeJob} connectionReady={connected && boardConnection.status === "connected"} onDraftChange={dirty=>{detailDirty.current=dirty;}} onUpdated={updated=>{setActiveJob(previous=>previous?mergeRiderJob(previous,{...previous,...updated}):previous);void loadJobs().catch(()=>{});void loadStats();}} onClose={closeJob}/>}</>}
    </DialogContent></Dialog>
  </div>;
}

function StatCard({
  icon,
  label,
  value,
  loading, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  loading?: boolean; onClick?: () => void;
}) {
  const content = loading ? <Skeleton className="h-12 w-full"/> : <><div className="rd-stat-icon" aria-hidden="true">{icon}</div><div className="rd-stat-copy"><p>{label}</p><strong>{value}</strong></div></>;
  return onClick ? <button type="button" className="rd-stat min-h-12 text-left focus-visible:outline-2 focus-visible:outline-ring" onClick={onClick} aria-label="View your customer ratings and reviews">{content}</button> : <article className="rd-stat">{content}</article>;
}

function OnlineToggle({
  pending,
  isOnline,
  matchingReady, activeJobs, offeredJobs, onResume,
  disabled = false,
  onToggle,
}: {
  pending: boolean;
  isOnline: boolean | null;
  matchingReady: boolean; activeJobs: number; offeredJobs: number; onResume: () => void;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      variant={isOnline ? "default" : "outline"}
      size="sm"
      onClick={() => isOnline && !matchingReady && !activeJobs && !offeredJobs ? onResume() : onToggle(!isOnline)}
      disabled={pending || disabled || isOnline === null}
      aria-label={availabilityLabel(isOnline, pending, matchingReady, activeJobs, offeredJobs) + (isOnline ? !matchingReady && !activeJobs && !offeredJobs ? '. Resume receiving jobs' : '. Go offline' : '. Go online')}
      className={cn("rd-online-toggle", isOnline && matchingReady && "is-online", isOnline && !matchingReady && !activeJobs && !offeredJobs && "is-paused")}
    >
      <PowerCircle className={cn("h-4 w-4", isOnline && matchingReady ? "text-emerald-500" : "text-current")} />
      {isOnline === null ? 'Checking…' : availabilityLabel(isOnline, pending, matchingReady, activeJobs, offeredJobs)}
    </Button>
  );
}

function EmptyJobs({
  tab,
  isOnline,
  paused = false, activeJobs = 0, pauseReason, onResume,
  onGoOnline, connected, onFindJobs, onActiveJobs,
}: {
  tab: "available" | "active" | "history";
  isOnline: boolean | null;
  connected: boolean; onFindJobs: () => void; onActiveJobs: () => void;
  onGoOnline: () => void;
  paused?: boolean; activeJobs?: number; pauseReason?: string; onResume: () => void;
}) {
  if (!connected) return <Card className="rd-empty"><CardContent className="py-10 text-center space-y-3"><h3 className="font-semibold text-lg">Connect to check your jobs</h3><p className="text-muted-foreground">We can’t confirm whether new jobs are available while your device is offline. This page checks again when your connection returns.</p></CardContent></Card>;
  if (tab === "history") {
    return (
      <Card className="rd-empty border-2 border-dashed bg-card">
        <CardContent className="py-16 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-muted grid place-items-center mb-4">
            <Clock className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg">No booking history yet</h3>
          <p className="text-muted-foreground mt-1">
            Completed and cancelled bookings will appear here.
          </p>
          <Button className="mt-5" onClick={onFindJobs}>Find available jobs</Button>
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
          {tab === "available" ? isOnline===null?'Checking your workspace…':activeJobs>0?'You’re on a job':paused?'Receiving jobs is paused':isOnline?'No nearby requests right now':'Go online when you’re ready' : "No active jobs"}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          {tab === "available"
            ? isOnline === null ? "Checking your availability. Please wait…" : activeJobs > 0 ? "Finish your current job before receiving another offer." : paused ? pauseReason : isOnline
              ? "No matching requests right now. New jobs for your vehicle and approved services appear automatically."
              : "You're offline — go online to start receiving job matches."
            : "Accept a job from the Available tab to start driving."}
        </p>
        {tab === "active" && <Button className="mt-5" onClick={onFindJobs}>Find available jobs</Button>}
        {tab === "available" && activeJobs > 0 && <Button className="mt-5" onClick={onActiveJobs}>Continue active job</Button>}
        {tab === "available" && paused && <Button className="mt-5" onClick={onResume}>Resume receiving jobs</Button>}
        {tab === "available" && !paused && isOnline === false && activeJobs === 0 && (
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

function compactAddress(value: string) { return value.split(',').map(part=>part.trim()).filter(part=>part&&!/^(Philippines|Pangasinan|\d{4})$/i.test(part)).join(', '); }
function JobCard({ job, isAvailable, upcoming = false, onOpen }: { job: Job; isAvailable: boolean; upcoming?: boolean; onOpen: () => void }) {
  const timing=jobTiming(job), stop=nextJobStop(job);
  return <Card className="rd-job-card">
    <CardHeader><div className="rd-card-meta"><JobTypeBadge type={job.type}/><span>{job.refCode}</span>{upcoming?<Badge variant="outline">Scheduled</Badge>:job.status==='PENDING'?<Badge variant="outline">New request</Badge>:<StatusBadge status={job.status} type={job.type==='RIDE'?'RIDE':'DELIVERY'}/>}</div></CardHeader>
    <CardContent><dl className="rd-itinerary rd-card-route"><div><dt>Pickup</dt><dd>{compactAddress(job.pickupLabel)}</dd></div><div><dt>Drop-off</dt><dd>{compactAddress(job.dropoffLabel)}</dd></div></dl>
      <div className="rd-card-facts rd-card-fare"><strong>₱{riderShare(job).toFixed(2)}<small>{job.paymentMethod==='CASH'?'Cash fare':'Rider share'}</small></strong><span>{job.distanceKm} km</span><span>{job.type==='RIDE'?(job.passengers??1)+((job.passengers??1)===1?' passenger':' passengers'):job.cargoWeightKg+' kg'}</span></div>
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
  connectionReady,
  onUpdated,
  onClose,
  onDraftChange,
}: {
  job: Job;
  connectionReady: boolean;
  onUpdated: (u: Partial<Job>) => void;
  onClose: () => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const { toast } = useToast();
  const ownerId = useAppStore(state => state.user?.id ?? "");
  const status = job.status;
  const recovery = useBookingRecovery(job.id, onUpdated, connectionReady);
  const ready = recovery.ready;
  const [updating, setUpdating] = useState(false);
  const advancePending = useRef(false);
  const [showProof, setShowProof] = useState(false);
  const [actionPhase, setActionPhase] = useState("");
  const [pickupOtp, setPickupOtp] = useState("");
  const [pickupOtpError, setPickupOtpError] = useState<string | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [proofState, setProofState] = useState<ProofState>({ busy: false, preparing: false, hasSignature: false, hasPhoto: false });
  const paymentSection=useRef<HTMLDivElement>(null), proofSection=useRef<HTMLDivElement>(null), pickupInput=useRef<HTMLInputElement>(null);
  const draftCallback=useRef(onDraftChange);
  useEffect(()=>{draftCallback.current=onDraftChange;},[onDraftChange]);
  useEffect(()=>{draftCallback.current(!!pickupOtp || !!proofState.unsafe);return()=>draftCallback.current(false);},[pickupOtp,proofState.unsafe]);
  useEffect(()=>{if(showProof)proofSection.current?.scrollIntoView({block:'start',behavior:'smooth'});},[showProof]);
  useEffect(() => {
    if (!ready || !ownerId) return;
    let cancelled = false;
    if (status !== 'IN_TRANSIT' || job.riderId !== ownerId) { void removeProofDraft(ownerId, job.id).catch(() => {}); return; }
    if (job.type !== 'RIDE') void readProofDraft(ownerId, job.id).then(draft => { if (!cancelled && draft) setShowProof(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ready, ownerId, job.id, job.riderId, job.type, status]);


  async function advance(to: BookingStatus) {
    if (advancePending.current || !ready || (to === 'DELIVERED' && !paymentReady)) return; advancePending.current = true;
    const timing = startBookingTiming("job_status");
    let outcome: "confirmed" | "recovered" | "failed" | "uncertain" = "uncertain";
    let uncertain = true;
    setUpdating(true); setActionPhase("Sending your booking update…");
    setPickupOtpError(null);
    try {
      const res = await fetch(`/api/bookings/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...timing.headers }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ status: to, ...(isRide && to === "PICKED_UP" ? { otp: pickupOtp } : {}) }),
      });
      timing.response(res); uncertain = res.ok || res.status >= 500;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      outcome = "confirmed";
      setPickupOtp("");
      onUpdated(data.booking);
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
      if (uncertain) {
        setActionPhase("Checking whether your update was already saved…");
        const order = ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
        const saved = await savedMutation<{ booking: Job }>(`/api/bookings/${job.id}`, state => state.booking?.id === job.id && state.booking.riderId === job.riderId && order.indexOf(state.booking.status) >= order.indexOf(to));
        if (saved) { outcome = "recovered"; setPickupOtp(""); onUpdated(saved.booking); if (saved.booking.status === "DELIVERED") setShowProof(false); toast({ title: "Your update is saved", description: job.refCode }); return; }
      }
      outcome = uncertain ? "uncertain" : "failed";
      void recovery.recheck();
      if (isRide && to === "PICKED_UP") { setPickupOtpError(pickupCodeFeedback(e instanceof Error ? e.message : "Could not verify the pickup code.")); return; }
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      advancePending.current = false; setUpdating(false); setActionPhase(""); timing.finish(outcome);
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
      {!ready && <section className="rd-notice" role="status"><p>{recovery.error || "Checking the latest booking before enabling updates. Your entered details are kept."}</p>{recovery.error && <Button variant="outline" disabled={!connectionReady} onClick={()=>void recovery.recheck()}>Retry booking check</Button>}</section>}
      {ready && recovery.confirmedAt > 0 && <p className="rd-help" role="status">Job status confirmed at {new Date(recovery.confirmedAt).toLocaleTimeString('en-PH', {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})} · PH time</p>}
      {actionPhase && <div className="space-y-2"><p className="rd-proof-status" role="status"><Loader2 size={20} className="animate-spin" aria-hidden="true"/>{actionPhase}</p><SlowRequestFeedback message="This update is taking longer than usual. Keep this job open while we check its status; avoid sending it again."/></div>}
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
      {isRide && status === "ACCEPTED" && <PickupProgress key={`pickup:${job.id}`} bookingId={job.id} disabled={!ready} onActionFailure={()=>void recovery.recheck()} />}
      <JobRouteMap key={`map:${job.id}`} bookingId={job.id} stage={job.status} vehicleClass={job.vehicleClass} pickup={{ lat: job.pickupLat, lng: job.pickupLng }} dropoff={{ lat: job.dropoffLat, lng: job.dropoffLng }} navigation={nextJobStop(job).navigation}/>
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

      <div ref={paymentSection} tabIndex={-1}><details className="rd-details" open={status === 'IN_TRANSIT'}><summary>Payment details<ChevronDown size={16} aria-hidden="true"/></summary><PaymentCard key={`${job.id}:${status}`} bookingId={job.id} role="RIDER" actionsDisabled={!ready} onActionFailure={()=>void recovery.recheck()} onPaymentReady={setPaymentReady} /></details></div>
      {["MATCHED", "ACCEPTED"].includes(status) && <ReleaseBooking id={job.id} disabled={!ready} onActionFailure={()=>void recovery.recheck()} onReleased={() => { onClose(); onUpdated({}); }} />}

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
            <p className="text-sm text-muted-foreground">At pickup, scan the passenger’s QR or enter their six-digit code. Verify it below to confirm the passenger is on board.</p>
            <PickupQrScanner bookingId={job.id} disabled={!ready || updating} onScan={code => { setPickupOtp(code); setPickupOtpError(null); }} />
            <Input ref={pickupInput} id={`pickup-otp-${job.id}`} inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6-digit code" value={pickupOtp} disabled={updating} onChange={event => { setPickupOtp(event.target.value.replace(/\D/g, "").slice(0, 6)); setPickupOtpError(null); }} aria-invalid={!!pickupOtpError} className="font-mono text-lg tracking-widest" />
            {pickupOtpError && <p role="alert" className="text-sm text-destructive">{pickupOtpError}</p>}
          </CardContent>
        </Card>
      )}

      {showProof && (
        <div ref={proofSection}><ProofCapture
          disabled={!ready || !paymentReady}
          onActionFailure={()=>void recovery.recheck()}
          bookingId={job.id}
          ownerId={ownerId}
          photoAlreadySaved={job.hasDeliveryPhoto ?? false}
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
              disabled={!ready || updating || (nextStatus === 'DELIVERED' && !paymentReady) || (isRide && nextStatus === "PICKED_UP" && !/^\d{6}$/.test(pickupOtp))}
              className="w-full"
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {nextLabel}
            </Button>
          )}
          {status === 'IN_TRANSIT' && isRide && !paymentReady && <><p className="rd-help">Payment must be confirmed before completing this ride.</p><Button variant="outline" onClick={()=>{paymentSection.current?.scrollIntoView({block:'start',behavior:'smooth'});paymentSection.current?.focus({preventScroll:true});}}>Review payment</Button></>}
          {status === 'IN_TRANSIT' && !isRide && job.paymentMethod === 'CASH' && !paymentReady && <><p className="rd-help">Confirm arrival and cash payment before collecting delivery proof.</p><Button variant="outline" onClick={()=>{paymentSection.current?.scrollIntoView({block:'start',behavior:'smooth'});paymentSection.current?.focus({preventScroll:true});}}>Review payment steps</Button></>}
          {status === "IN_TRANSIT" && !isRide && !showProof && (
            <Button
              size="lg"
              onClick={() => setShowProof(true)}
              disabled={!ready || updating || !paymentReady}
            >
              <ShieldCheck className="h-4 w-4" /> Capture signature & photo
            </Button>
          )}
          {showProof && <><p className="rd-proof-checklist" role="status"><span className={proofState.hasSignature ? 'is-ready' : ''}>{proofState.hasSignature ? '✓ Signature ready' : '○ Signature needed'}</span><span className={proofState.hasPhoto ? 'is-ready' : ''}>{proofState.hasPhoto ? '✓ Photo ready' : '○ Photo needed'}</span></p><Button type="submit" form={`delivery-proof-${job.id}`} disabled={!ready || !paymentReady || proofState.busy || updating || !proofState.hasSignature || !proofState.hasPhoto}>{proofState.preparing ? 'Preparing photo…' : proofState.busy ? 'Confirming delivery…' : 'Complete delivery'}</Button><Button variant="ghost" disabled={proofState.busy} onClick={()=>{if(!proofState.unsafe || window.confirm("Some proof details have not finished saving. Close anyway?"))setShowProof(false);}}>Close proof capture</Button></>}
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
