"use client";
import { useCallback, useEffect, useState } from "react";
import { SECTION_FIELDS, FIELD_LABELS, DOCUMENT_LABELS, requiredDocuments, type Fields, type Review } from "@/lib/rider-application-policy";
import { useAppStore } from "@/lib/store";
import { RiderDashboard } from "./rider-dashboard";
import "./rider-application.css";

type Doc = { id: string; kind: string; current: boolean; status: string; reason?: string };
type Application = { id: string; version: number; status: string; vehicleClass: string; services: string[]; fields: Fields; fieldReviews: Record<string, Review>; documents: Doc[]; emailVerifiedAt?: string; orientationAt?: string; orientationVenue?: string; orientationInstructions?: string; emails: { id: string; kind: string; status: string }[] };
type Approval = { service: string; vehicleClass: string; source: string; validUntil?: string };
const label = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
const endpoint = "/api/rider/application";
export function RiderApplicationBoundary() {
  const email = useAppStore(s => s.user?.email);
  const userId = useAppStore(s => s.user?.id), logout = useAppStore(s => s.logout);
  const [app, setApp] = useState<Application | null>(null), [approvals, setApprovals] = useState<Approval[]>([]), [fields, setFields] = useState<Fields>({}), [vehicle, setVehicle] = useState("MOTORCYCLE"), [services, setServices] = useState(["DELIVERY"]);
  const [working, setWorking] = useState(false), [canWork, setCanWork] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [code, setCode] = useState("");
  const [extra, setExtra] = useState(false);
  const hydrate = useCallback((a: Application) => { setApp(a); setFields(a.fields); setVehicle(a.vehicleClass); setServices(a.services); }, []);
  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    try {
      const res = await fetch(endpoint, { cache: "no-store", signal }); const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data.error || "Application unavailable.");
      hydrate(data.application); setApprovals(data.approvals); setCanWork(data.canWork);
      if (initial) setWorking(data.canWork);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Application unavailable."); } finally { if (!signal?.aborted) setLoading(false); }
  }, [hydrate]);
  useEffect(() => { const controller = new AbortController(); // Initial fetch updates state only after the response; abort prevents stale account data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId) void load(true, controller.signal); return () => controller.abort(); }, [userId, load]);

  async function request(body: Record<string, unknown>) {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: app?.version, ...body }) });
    const result = await res.json(); if (!res.ok) throw new Error(result.error || "Could not save your application.");
    if (result.application) hydrate(result.application); return result;
  }
  async function perform(action: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await request({ action, fields, vehicleClass: vehicle, services, code });
      setNotice(action === "submit" ? "Application submitted. We will notify you about the review." : action === "send-code" ? "Code sent. Check your inbox and spam folder." : action === "verify-code" ? "Email verified." : "Draft saved.");
      if (action === "verify-code") setCode("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your application."); } finally { setBusy(false); }
  }
  async function upload(kind: string, file?: File) {
    if (!file || !app) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error("Choose a file up to 3 MB.");
      const saved = await request({ action: "save", fields, vehicleClass: vehicle, services });
      const form = new FormData(); form.set("file", file); form.set("kind", kind); form.set("version", String(saved.application.version));
      if (kind === "NBI" && fields.nbiExpiry) form.set("expiresAt", fields.nbiExpiry);
      if (kind.startsWith("LICENCE") && fields.licenceExpiry) form.set("expiresAt", fields.licenceExpiry);
      const res = await fetch(endpoint, { method: "POST", body: form }); const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload failed."); hydrate(result.application); setNotice(`${DOCUMENT_LABELS[kind]} uploaded for review.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setBusy(false); }
  }
  if (loading) return <main className="ra"><p role="status">Loading your rider application…</p></main>;
  if (working && canWork) return <><div className="ra-work-link"><button onClick={() => { setWorking(false); void load(); }}>Application & service approvals</button></div><RiderDashboard/></>;
  const editable = app && ["DRAFT", "NEEDS_CORRECTION"].includes(app.status);
  const documents = requiredDocuments(vehicle, services, fields);
  return <main className="ra"><header className="ra-header"><a href="/" aria-label="Fetch-It home"><img src="/rider-logo.png" alt="" width="44" height="44"/><strong>Fetch-It <span>Rider applications</span></strong></a><button onClick={() => void logout()}>Sign out</button></header>
    <div className="ra-intro"><p className="ra-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h1>Let’s get you ready<br/>for the road.</h1><p>One application. A clear checklist. Updates at every step.</p><div className="ra-status">{label(app?.status || "DRAFT")}</div></div>
    {error && <p role="alert" className="ra-error">{error}</p>}{notice && <p role="status" className="ra-notice">{notice}</p>}
    {!app && <button onClick={() => void load()}>Retry loading</button>}
    {canWork && <section className="ra-card"><h2>Your current service access</h2>{approvals.map((a, i) => <p key={i}><strong>{label(a.vehicleClass)} · {label(a.service)}</strong><br/><small>{a.source === "LEGACY_EXISTING" ? "Existing rider access preserved. This is not a document-verification badge." : `Approved${a.validUntil ? " until " + new Date(a.validUntil).toLocaleDateString("en-PH") : ""}`}</small></p>)}<button className="ra-primary" onClick={() => setWorking(true)}>Open rider dashboard</button></section>}
    {app && <><nav className="ra-steps" aria-label="Application progress">{["Details", "Documents", "Review", "Orientation", "Activation"].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</nav>
      <section className="ra-card"><h2>1. Verify your email</h2><p>{email}</p>{app.emailVerifiedAt ? <p className="ra-success">✓ Email verified</p> : <div className="ra-inline"><button disabled={busy} onClick={() => void perform("send-code")}>Send verification code</button><label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}/></label><button disabled={busy || code.length !== 6} onClick={() => void perform("verify-code")}>Verify email</button></div>}</section>
      <section className="ra-card"><h2>2. Your vehicle & services</h2><label>Vehicle<select value={vehicle} disabled={!editable || app.status !== "DRAFT" || busy} onChange={e => setVehicle(e.target.value)}><option value="MOTORCYCLE">Motorcycle</option><option value="TRICYCLE">Tricycle</option><option value="SEDAN">Car</option></select></label><div className="ra-inline">{["DELIVERY", "RIDE"].map(service => <label className="ra-check" key={service}><input type="checkbox" disabled={!editable || app.status !== "DRAFT" || busy} checked={services.includes(service)} onChange={e => setServices(e.target.checked ? ["DELIVERY", "RIDE"].filter(s => s === service || services.includes(s)) : services.filter(s => s !== service))}/>{service === "RIDE" ? "Passenger rides" : "Delivery"}</label>)}</div><p className="ra-help">Choosing both services creates separate approvals. Passenger permits and operating-area requirements depend on the vehicle and location.</p></section>
      <section><h2 className="ra-section-title">3. Application details</h2>{Object.entries(SECTION_FIELDS).map(([section, keys], index) => {
        const review = app.fieldReviews[section], locked = !editable || app.status === "NEEDS_CORRECTION" && review?.status !== "NEEDS_CORRECTION";
        return <details className="ra-card" key={section} open={review?.status === "NEEDS_CORRECTION" || index === 0}><summary>{label(section)} <span>{label(review?.status || "PENDING")}</span></summary>{review?.reason && <p className="ra-error">{review.reason}</p>}<div className="ra-grid">{keys.filter(key => !(key === "displacement" && vehicle === "SEDAN") && !(key === "permitNumber" && (!services.includes("RIDE") || vehicle === "MOTORCYCLE"))).map(key => <label key={key}>{FIELD_LABELS[key]}{key === "ownership" ? <select value={fields[key] || ""} disabled={locked || busy} onChange={e => setFields({ ...fields, [key]: e.target.value })}><option value="">Choose ownership</option><option value="OWNER">Registered owner</option><option value="BORROWED">Borrowed / operated for someone else</option><option value="PURCHASED">Purchased; registration transfer pending</option></select> : <input type={key === "birthDate" || key.endsWith("Expiry") ? "date" : ["vehicleYear", "capacity", "displacement"].includes(key) ? "number" : key === "mobile" || key === "emergencyPhone" ? "tel" : "text"} value={fields[key] || ""} disabled={locked || busy} maxLength={key === "address" ? 1000 : 200} onChange={e => setFields({ ...fields, [key]: e.target.value })}/>}</label>)}</div></details>;
      })}</section>
      <section className="ra-card"><h2>4. Your document checklist</h2><p className="ra-help">Readable JPEG, PNG, WebP or unencrypted PDF, up to 3 MB. Profile photos must be images. Only flagged uploads need replacement during corrections.</p>
        {[...documents, ...app.documents.filter(d => d.current && !documents.includes(d.kind)).map(d => d.kind), ...(extra ? ["MEDICAL", "DRUG_TEST"].filter(k => !app.documents.some(d => d.current && d.kind === k)) : [])].filter((k,i,a) => a.indexOf(k) === i).map(kind => {
          const doc = app.documents.find(d => d.current && d.kind === kind), locked = !editable || app.status === "NEEDS_CORRECTION" && (doc ? doc.status !== "NEEDS_CORRECTION" : !documents.includes(kind));
          return <div className="ra-document" key={kind}><div><strong>{DOCUMENT_LABELS[kind]}</strong><span className="ra-status">{doc ? label(doc.status) : "Not uploaded"}</span></div>{doc?.reason && <p className="ra-error">{doc.reason}</p>}{doc && <a href={`${endpoint}?document=${doc.id}`} target="_blank" rel="noreferrer">View current document ↗</a>}{!locked && <label>{doc ? "Replace document" : "Upload document"}<input type="file" accept={kind === "PROFILE" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"} disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void upload(kind, file); }}/></label>}</div>;
        })}{editable && <button onClick={() => setExtra(!extra)}>{extra ? "Hide additional slots" : "Additional medical / drug-test documents, if requested"}</button>}</section>
      {app.orientationAt && <section className="ra-card"><h2>Your orientation</h2><p><strong>{new Date(app.orientationAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "short" })} — Philippine time</strong></p><p>{app.orientationVenue}</p><p>{app.orientationInstructions}</p><a className="ra-link-button" href={`${endpoint}?letter=1`}>Download invitation letter (PDF)</a><p className="ra-help">Document acceptance does not activate your account. Attend orientation and complete the required assessments.</p></section>}
      {!editable && <section className="ra-card"><h2>Your next step</h2><p>{app.status === "ACTIVE" ? "Your approved services are listed above. Other requested services may still be awaiting activation." : app.status === "ORIENTATION_SCHEDULED" ? "Attend your scheduled orientation. Your reviewer will record attendance and assessment results." : "Your application is with the reviewing team. Check back here for updates and correction requests."}</p><button disabled={busy} onClick={() => void load()}>Check application status</button></section>}
      {editable && <footer className="ra-actions"><button disabled={busy} onClick={() => void perform("save")}>{busy ? "Saving…" : "Save draft"}</button><button className="ra-primary" disabled={busy} onClick={() => void perform("submit")}>{app.status === "NEEDS_CORRECTION" ? "Resubmit corrected application" : "Submit for review"}</button></footer>}
      <p className="ra-help">Your documents are private and available only to you and authorized reviewers. Submitted details are used to assess your application and service eligibility.</p>
    </>}
  </main>;
}
