"use client";

// Auth view for the Fetch-It RIDER app.
// Riders only — customers book deliveries from the separate Fetch-It
// Customer app. Rider signups include vehicle class + plate so the
// matching engine can filter jobs.

import { useState } from "react";
import { ArrowLeft, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { FetchItLogo } from "./logo";
import { useAppStore } from "@/lib/store";
import { VEHICLE_LIST, type VehicleClass } from "@/lib/constants";

const DEMO_EMAIL = "rider@fetchit.app";
const DEMO_PASSWORD = "demo1234";

export function AuthView({ initialMode }: { initialMode: "login" | "signup" }) {
  const setView = useAppStore((s) => s.setView);
  const setUser = useAppStore((s) => s.setUser);
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Shared fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup-only fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("CLOSED_VAN");
  const [vehiclePlate, setVehiclePlate] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            password,
            role: "RIDER",
            phone,
            vehicleClass,
            vehiclePlate,
          }),
        });
        const data = await res.json();
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

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <Card className="border-2 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary">
                  {mode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <CardTitle className="text-xl">
                    {mode === "login" ? "Welcome back, rider" : "Create your rider account"}
                  </CardTitle>
                  <CardDescription>
                    {mode === "login"
                      ? "Sign in to go online and start earning."
                      : "Tell us about your vehicle so we can match you with jobs."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs
                value={mode}
                onValueChange={(v) => setMode(v as "login" | "signup")}
              >
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="signup">Sign up</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4">
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
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        minLength={4}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 4 characters"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                      Sign in as rider
                    </Button>
                  </form>
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
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
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Need to send a package? Use the Fetch-It Customer app to book.
                  </p>
                </TabsContent>

                <TabsContent value="signup" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full name</Label>
                      <Input
                        id="name"
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone (optional)</Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+63 917 000 0000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password-su">Password</Label>
                        <Input
                          id="password-su"
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={4}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="At least 4 characters"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2 col-span-2 sm:col-span-1">
                        <Label htmlFor="vehicleClass">Vehicle class</Label>
                        <Select
                          value={vehicleClass}
                          onValueChange={(v) => setVehicleClass(v as VehicleClass)}
                        >
                          <SelectTrigger id="vehicleClass">
                            <SelectValue placeholder="Pick a vehicle" />
                          </SelectTrigger>
                          <SelectContent>
                            {VEHICLE_LIST.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 col-span-2 sm:col-span-1">
                        <Label htmlFor="plate">Vehicle plate</Label>
                        <Input
                          id="plate"
                          value={vehiclePlate}
                          onChange={(e) => setVehiclePlate(e.target.value)}
                          placeholder="ABC-1234"
                        />
                      </div>
                    </div>

                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Create rider account
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground justify-center">
              By continuing, you agree to Fetch-It's Terms of Service and Privacy Policy.
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
