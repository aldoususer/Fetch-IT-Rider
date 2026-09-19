"use client";

// Landing page — the public storefront for the Fetch-It RIDER app.
// Hero, features grid, a rider CTA card, demo callouts, and a footer.
// Customers are not part of this app — they use the separate Fetch-It
// Customer app to book deliveries.

import { useEffect, useState } from "react";
import {
  Bike,
  MapPin,
  ShieldCheck,
  Navigation,
  PenTool,
  Cpu,
  Wallet,
  Clock,
  Star,
  ArrowRight,
  Smartphone,
  Play,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FetchItLogo } from "./logo";
import { useAppStore, type Role } from "@/lib/store";

const FEATURES = [
  {
    icon: Cpu,
    title: "Automatic Job Matching",
    desc: "New bookings that fit your vehicle class appear on your jobs board the moment customers book — claim them with one tap.",
  },
  {
    icon: Navigation,
    title: "Turn-by-Turn Routing",
    desc: "Optimized pickup and drop-off paths with live GPS so you spend less time in traffic and more time earning.",
  },
  {
    icon: PenTool,
    title: "Fast e-POD Capture",
    desc: "Collect recipient signatures, verify OTP codes, and snap photo proofs in seconds to close out every job.",
  },
  {
    icon: Wallet,
    title: "Clear Earnings Tracking",
    desc: "See every payout as you complete deliveries — fare, surge bonus, and your lifetime earnings at a glance.",
  },
  {
    icon: MapPin,
    title: "Location-Aware Dispatch",
    desc: "Go online and share your position so nearby jobs are routed to you first — go offline any time.",
  },
  {
    icon: ShieldCheck,
    title: "Verified Customers & OTP",
    desc: "Every handover is protected by OTP validation and digital proofs, so you deliver with confidence.",
  },
];

const STEPS = [
  { n: "01", t: "Sign up & add your vehicle", d: "Tell us your vehicle class — motorcycle to refrigerated van — and plate number." },
  { n: "02", t: "Go online", d: "Toggle your status and share your location to start receiving nearby jobs." },
  { n: "03", t: "Claim & pick up", d: "Accept a job from the board, navigate to the pickup, and confirm the cargo." },
  { n: "04", t: "Deliver & get paid", d: "Capture OTP, signature or photo proof on arrival — the payout lands in your wallet." },
];

export function LandingView() {
  const setView = useAppStore((s) => s.setView);
  const setPendingRole = useAppStore((s) => s.setPendingRole);
  const [seeded, setSeeded] = useState(false);

  // Pre-seed demo accounts once so the "Try demo" button works instantly.
  useEffect(() => {
    fetch("/api/auth/seed", { method: "POST" })
      .then(() => setSeeded(true))
      .catch(() => setSeeded(true));
  }, []);

  function pickRole(role: Role, view: "login" | "signup") {
    setPendingRole(role);
    setView(view);
  }

  async function tryDemo(role: Role) {
    const email = "rider@fetchit.app";
    setPendingRole(role);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "demo1234", role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Demo login failed. Please try signing up first.");
      return;
    }
    const data = await res.json();
    useAppStore.getState().setUser(data.user);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <FetchItLogo />
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => pickRole("RIDER", "login")}>
              Login
            </Button>
            <Button size="sm" onClick={() => pickRole("RIDER", "signup")}>
              Become a rider
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" />
                  Installable PWA · Standalone rider app
                </span>
              </Badge>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
                Drive. Deliver.
                <br />
                <span className="text-primary">Get paid.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl">
                Fetch-It Rider is the driver side of the Fetch-It logistics
                platform. Go online, get matched with nearby delivery jobs that
                fit your vehicle, and earn on every completed delivery — from
                motorcycle parcels to full flatbed hauls.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => pickRole("RIDER", "signup")}>
                  Start driving <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => pickRole("RIDER", "login")}>
                  Rider login
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pt-2">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <span>4.9 average rider rating</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>&lt; 3 min average match time</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>Parcels insured up to ₱5,000</span>
                </div>
              </div>
            </div>

            {/* Hero card with mock map */}
            <HeroCard />
          </div>
        </div>
      </section>

      {/* Rider CTA */}
      <section id="personas" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 w-full">
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight">Everything you need to earn</h2>
          <p className="text-muted-foreground mt-3">
            One app for the whole job: claim deliveries, navigate, capture proof, and watch your payouts grow.
          </p>
        </div>
        <div className="max-w-2xl mx-auto">
          <Card className="border-2 hover:border-primary/40 transition shadow-sm">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl">I'm a Rider</CardTitle>
                  <CardDescription className="mt-1 text-base">
                    Get matched and earn on every delivery.
                  </CardDescription>
                </div>
                <div className="grid place-items-center h-12 w-12 rounded-xl bg-primary/10 text-primary">
                  <Bike className="h-6 w-6" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                {[
                  "Auto-matched jobs near you",
                  "Optimized turn-by-turn routing",
                  "Capture e-POD in seconds",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-foreground/80">{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button className="flex-1 min-w-[140px]" onClick={() => pickRole("RIDER", "login")}>
                  Rider login
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 min-w-[140px]"
                  onClick={() => pickRole("RIDER", "signup")}
                >
                  Sign up as rider
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                disabled={!seeded}
                onClick={() => tryDemo("RIDER")}
              >
                <Play className="h-3.5 w-3.5" />
                {seeded ? "Try the demo rider account" : "Preparing demo…"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="bg-muted/40 border-y w-full">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight">Built for drivers on the road</h2>
            <p className="text-muted-foreground mt-3">
              Every tool you need between accepting a job and cashing out.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <Card key={f.title} className="border bg-card hover:shadow-md transition">
                <CardHeader>
                  <div className="grid place-items-center h-11 w-11 rounded-lg bg-primary/10 text-primary mb-2">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 w-full">
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold tracking-tight">From going online to cashing out</h2>
        </div>
        <div className="grid md:grid-cols-4 gap-5">
          {STEPS.map((s) => (
            <Card key={s.n} className="border bg-card">
              <CardHeader>
                <div className="text-3xl font-bold text-primary/40">{s.n}</div>
                <CardTitle className="text-base mt-2">{s.t}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 flex flex-col sm:flex-row justify-between gap-6 items-start sm:items-center">
          <div className="space-y-2">
            <FetchItLogo />
            <p className="text-sm text-muted-foreground max-w-md">
              Fetch-It Rider — the driver app for the Fetch-It logistics
              network. Built as a standalone PWA on Next.js 16, deployable
              anywhere.
            </p>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>© {new Date().getFullYear()} Fetch-It. All rights reserved.</p>
            <p>Deployed on Vercel · Made for riders.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Hero side panel — stylized map mock with a job in transit.
function HeroCard() {
  return (
    <div className="relative">
      <Card className="relative overflow-hidden border-2 shadow-xl">
        <div className="aspect-[4/3] sm:aspect-[5/4] bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30">
          {/* mock map */}
          <svg
            viewBox="0 0 400 320"
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <pattern id="streets" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="1.2" />
              </pattern>
            </defs>
            <rect width="400" height="320" fill="url(#streets)" />
            {/* route */}
            <path
              d="M 60 260 Q 130 230 180 180 T 340 60"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="8 8"
              className="animate-route-dash"
              opacity="0.9"
            />
            {/* pickup */}
            <g transform="translate(60, 260)">
              <circle r="10" fill="var(--primary)" opacity="0.2" />
              <circle r="6" fill="var(--primary)" />
              <text y="-14" textAnchor="middle" fontSize="11" fill="#1f2937" fontWeight="700">Pickup</text>
            </g>
            {/* dropoff */}
            <g transform="translate(340, 60)">
              <circle r="10" fill="#059669" opacity="0.2" />
              <circle r="6" fill="#059669" />
              <text y="-14" textAnchor="middle" fontSize="11" fill="#065f46" fontWeight="700">Drop-off</text>
            </g>
            {/* rider */}
            <g transform="translate(190, 170)">
              <circle r="14" fill="var(--primary)" opacity="0.18" className="animate-fit-pulse" />
              <circle r="9" fill="var(--primary)" />
              <path d="M -3 -1 L 0 -4 L 3 -1 L 1 -1 L 1 3 L -1 3 L -1 -1 Z" fill="white" />
            </g>
          </svg>

          {/* live chip */}
          <div className="absolute top-3 left-3 bg-card/95 backdrop-blur rounded-full px-2.5 py-1 text-xs font-medium border shadow-sm flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-fit-pulse" />
            Online · Job FIT-2099
          </div>

          {/* job card */}
          <div className="absolute bottom-3 left-3 right-3 bg-card/95 backdrop-blur rounded-xl p-3 border shadow-sm flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/15 grid place-items-center text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">Closed Van · FIT-2099</p>
              <p className="text-xs text-muted-foreground truncate">Payout ₱48.20 · 8.4 km · ★ 4.9</p>
            </div>
            <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-xs">
              In transit
            </Badge>
          </div>
        </div>
      </Card>
      <div
        className="absolute -bottom-3 -right-3 -z-10 w-32 h-32 rounded-full blur-2xl bg-primary/30"
        aria-hidden
      />
    </div>
  );
}
