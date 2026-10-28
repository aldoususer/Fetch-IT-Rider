"use client";

// Auth view for the Fetch-It RIDER app.
// Riders only — customers book deliveries from the separate Fetch-It
// Customer app. Registration creates a resumable application before vehicle selection.

import { validNewPassword, PASSWORD_REQUIREMENT, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useState } from "react";
import { ArrowLeft, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { FetchItLogo } from "./logo";
import { useAppStore } from "@/lib/store";
import { RegistrationProgress } from "../rider/registration-progress";
import "../rider/rider-application.css";
import { useLocalDemo } from '@/hooks/use-local-demo';

const DEMO_EMAIL = "rider@fetchit.app";
const DEMO_PASSWORD = "demo1234";

export function AuthView({ initialMode }: { initialMode: "login" | "signup" }) {
  const lab = useLocalDemo();
  const setView = useAppStore((s) => s.setView);
  const setUser = useAppStore((s) => s.setUser);
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Shared fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup-only fields
  const [name, setName] = useState("");
  const [forDemo, setForDemo] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  async function createDemoAccount() {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/local-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'account' }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Demo account could not be created.');
      setUser(data.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'Demo account failed.'); } finally { setLoading(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExistingAccount(false);
    setLoading(true);
    try {
      if (mode === "login") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, role: "RIDER" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        setUser(data.user);
      } else {
        if (!validNewPassword(password)) throw new Error(PASSWORD_REQUIREMENT);
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            password,
            role: "RIDER",
            forDemo,
          }),
        });
        const data = await res.json();
        if (res.status === 409) setExistingAccount(true);
        if (!res.ok) throw new Error(data.error || "Sign up failed");
        setUser(data.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function tryDemo() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD, role: "RIDER" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Demo login failed");
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => setView("landing")}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <FetchItLogo showWordmark={false} size={28} />
        </div>
      </header>

      <main className={`flex-1 px-4 py-8 ${mode === "signup" ? "ra ra-auth" : "flex items-center justify-center"}`}>
        <div className={`w-full mx-auto ${mode === "signup" ? "max-w-2xl" : "max-w-md"}`}>
          {mode === "signup" && <><div className="ra-intro"><p className="ra-eyebrow">BECOME A FETCH-IT RIDER</p><h1>Your road<br/>starts here.</h1><p>One application, from your first detail to your final review. Save your progress and come back anytime.</p></div><RegistrationProgress step={0}/></>}
          {lab.enabled && <aside className="ra-card" style={{ borderColor: '#c87338' }}><strong>LOCAL DEMO LAB</strong><p>Fictional test accounts and Lingayen–Dagupan data. Documents and emails stay in this isolated lab.</p><Button type="button" disabled={loading} onClick={() => void createDemoAccount()}>Use demo · new random rider</Button><p><a href={lab.adminUrl} target="_blank" rel="noreferrer">Open connected demo Admin ↗</a></p></aside>}
          <Card className="border-2 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary">
                  {mode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <CardTitle className="text-xl">
                    {mode === "login" ? "Welcome back, rider" : "Step 1 · Create your account"}
                  </CardTitle>
                  <CardDescription>
                    {mode === "login"
                      ? "Sign in to go online and start earning."
                      : "Start with your name and email. Verify your email next, then choose your vehicle and services."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs
                value={mode}
                onValueChange={(v) => { setMode(v as "login" | "signup"); setError(null); setExistingAccount(false); }}
              >
                {!lab.enabled && mode === 'signup' && <aside className="rounded-xl border border-orange-200 bg-orange-50 p-4 mb-4 space-y-3">
                  <strong>Try the rider application — for demo</strong>
                  <p className="text-sm">Explore every step with random Lingayen–Dagupan details and sample documents. Enter your own email and password below; verification and review emails go to your inbox.</p>
                  <Button type="button" variant="outline" disabled={loading} onClick={() => { setForDemo(true); setName(`Demo ${['Mateo Dizon', 'Liza Cruz', 'Carlo Reyes', 'Ana Ramos', 'Paolo Soriano'][Math.floor(Math.random() * 5)]}`); }}>Use demo · Account</Button>
                  <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={forDemo} disabled={loading} onChange={e => setForDemo(e.target.checked)}/>Register for demo. Sample documents cannot activate real rider services.</label>
                </aside>}
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="signup">Sign up</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4" aria-busy={loading}>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <PasswordInput
                        id="password"
                        autoComplete="current-password"
                        required
                        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 1}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        maxLength={128}
                          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                      />
                    </div>
                    {error && (
                      <p role="alert" className="text-sm text-destructive">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      Sign in as rider
                    </Button>
                  </form>
                  {!lab.enabled && (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED === "true") && <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      Demo account
                    </div>
                    <div className="space-y-1 font-mono">
                      <div>rider@fetchit.app · demo1234</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={loading}
                      onClick={() => tryDemo()}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      Try the demo rider account
                    </Button>
                  </div>}
                  <p className="text-center text-xs text-muted-foreground">
                    Need to send a package? Use the Fetch-It Customer app to book.
                  </p>
                </TabsContent>

                <TabsContent value="signup" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4" aria-busy={loading}>
                    <div className="space-y-2">
                      <Label htmlFor="name">Full name</Label>
                      <Input
                        id="name"
                        autoComplete="name"
                        maxLength={80}
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Juan Dela Cruz"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email-su">Email</Label>
                      <Input
                        id="email-su"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password-su">Create a password</Label>
                      <PasswordInput id="password-su" autoComplete="new-password" required
                        minLength={PASSWORD_MIN_LENGTH} maxLength={128} value={password}
                        onChange={e => setPassword(e.target.value)} aria-describedby="signup-password-help"/>
                      <p id="signup-password-help" className="text-xs text-muted-foreground">{PASSWORD_REQUIREMENT}</p>
                    </div>
                    <p className="ra-help">Already started? Sign in to continue your saved application. Vehicle information and documents come in the next steps.</p>

                    {error && (
                      <p role="alert" className="text-sm text-destructive">{error}</p>
                    )}
                    {existingAccount && <div className="rounded-lg border p-3 text-sm"><p>Your account may already be created. Sign in with the same email and password to continue.</p><Button type="button" variant="outline" className="mt-2 w-full" onClick={() => { setMode("login"); setError(null); setExistingAccount(false); }}>Sign in & continue application</Button></div>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Create account & continue
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground justify-center">
              {lab.enabled ? 'Local demonstration only. This does not create a real rider registration or agreement.' : "By continuing, you agree to Fetch-It's Terms of Service and Privacy Policy."}
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
