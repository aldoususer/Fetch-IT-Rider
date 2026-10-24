"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SECTION_FIELDS, FIELD_LABELS, DOCUMENT_LABELS, requiredDocuments, type Fields, type Review } from "@/lib/rider-application-policy";
import { useAppStore } from "@/lib/store";
import { RiderDashboard } from "./rider-dashboard";
import { RegistrationProgress } from './registration-progress';
import { REGISTRATION_STEPS, STEP_KEYS, resumeRegistration, registrationIssues, visibleFields, type RegistrationStep } from '@/lib/rider-registration';
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
  const [step, setStep] = useState<RegistrationStep>(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const editable = !!app && ["DRAFT", "NEEDS_CORRECTION"].includes(app.status);
  const dirty = !!app && editable && (JSON.stringify(fields) !== JSON.stringify(app.fields) || vehicle !== app.vehicleClass || JSON.stringify(services) !== JSON.stringify(app.services));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const hydrate = useCallback((a: Application) => { setApp(a); setFields(a.fields); setVehicle(a.vehicleClass); setServices(a.services); }, []);
  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    try {
      const res = await fetch(endpoint, { cache: "no-store", signal }); const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data.error || "Application unavailable.");
      hydrate(data.application); setApprovals(data.approvals); setCanWork(data.canWork);
      if (initial) { setWorking(data.canWork); setStep(resumeRegistration(data.application)); }
      else if (!["DRAFT", "NEEDS_CORRECTION"].includes(data.application.status)) setStep(4);
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
      if (action === "verify-code") { setCode(""); setStep(1); }
      if (action === "submit") setStep(4);
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
  async function goTo(next: RegistrationStep, validate = false, exit = false) {
    if (!app || busy) return;
    if (next > 0 && !app.emailVerifiedAt) { setError("Verify your email to continue."); return; }
    if (validate) {
      const issue = registrationIssues(app, vehicle, services, fields).find(item => item.step === step);
      if (issue) { setError(issue.message); return; }
    }
    setBusy(true); setError(""); setNotice("");
    try {
      if (editable) await request({ action: "save", fields: { ...fields, registrationStep: STEP_KEYS[Math.max(1, next)] }, vehicleClass: vehicle, services });
      if (exit) { await logout(); return; }
      setStep(next); setNotice(editable ? "Progress saved. You can return to this step anytime." : "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your progress."); } finally { setBusy(false); }
  }
  if (loading) return <main className="ra"><p role="status">Loading your rider application…</p></main>;
  if (working && canWork) return <><div className="ra-work-link"><button onClick={() => { setWorking(false); void load(); }}>Application & service approvals</button></div><RiderDashboard/></>;
  const documents = requiredDocuments(vehicle, services, fields);
  const issues = app ? registrationIssues(app, vehicle, services, fields) : [];
  const vehicleName = vehicle === "SEDAN" ? "Car" : label(vehicle);
  return <main className="ra"><header className="ra-header"><a href="/" aria-label="Fetch-It home"><img src="/rider-logo.png" alt="" width="44" height="44"/><strong>Fetch-It <span>Rider registration</span></strong></a><button disabled={busy} onClick={() => { if (editable) void goTo(step, false, true); else void logout(); }}>{editable ? "Save & exit" : "Sign out"}</button></header>
    <div className="ra-intro"><p className="ra-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h1>{editable ? <>Your road.<br/>One step at a time.</> : <>Your application,<br/>at a glance.</>}</h1><p>{editable ? "One application. A clear checklist. Pick up where you left off." : "Follow your review, orientation and service approvals here."}</p><div className="ra-status">{label(app?.status || "DRAFT")}</div></div>
    {error && <div role="alert" className="ra-error"><p>{error}</p><button disabled={busy} onClick={() => void load()}>Refresh saved application</button></div>}{notice && <p role="status" className="ra-notice">{notice}</p>}
    {!app && <button onClick={() => void load(true)}>Retry loading</button>}
    {canWork && <section className="ra-card"><h2>Your current service access</h2>{approvals.map((a, i) => <p key={i}><strong>{label(a.vehicleClass)} · {label(a.service)}</strong><br/><small>{a.source === "LEGACY_EXISTING" ? "Existing rider access preserved. This is not a document-verification badge." : `Approved${a.validUntil ? " until " + new Date(a.validUntil).toLocaleDateString("en-PH") : ""}`}</small></p>)}<button className="ra-primary" onClick={() => setWorking(true)}>Open rider dashboard</button></section>}
    {app && <>
      <RegistrationProgress step={step} verified={!!app.emailVerifiedAt} busy={busy} onSelect={next => void goTo(next)}/>
      <div className="ra-step-heading"><p className="ra-eyebrow">STEP {step + 1} OF 5</p><h2 ref={heading} tabIndex={-1}>{REGISTRATION_STEPS[step]}</h2><span className="ra-save-state">{busy ? "Saving…" : dirty ? "Unsaved changes · save before leaving" : "Your progress is saved"}</span></div>
      {step === 0 && <section className="ra-card"><h3>Verify your email</h3><p>Your account is created. We’ll use <strong>{email}</strong> for application updates.</p>{app.emailVerifiedAt ? <><p className="ra-success">✓ Email verified</p><p>Your account details are saved. Continue to your vehicle and services.</p></> : <><p className="ra-help">Send a six-digit code to this address, then enter it below. You can sign in later to continue.</p><div className="ra-inline"><button disabled={busy} onClick={() => void perform("send-code")}>Send verification code</button><label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}/></label><button disabled={busy || code.length !== 6} onClick={() => void perform("verify-code")}>Verify email & continue</button></div></>}</section>}
      {step === 1 && <section className="ra-card"><h3>What will you drive?</h3><p className="ra-help">Choose your vehicle once. Your details and document checklist will adapt to it.</p><div className="ra-vehicle-options">{[["MOTORCYCLE", "Motorcycle", "Two-wheel journeys"], ["TRICYCLE", "Tricycle", "Local trips and deliveries"], ["SEDAN", "Car", "More room for the road"]].map(([value, name, description]) => <label key={value} className={`ra-choice ${vehicle === value ? "is-selected" : ""}`}><input type="radio" name="application-vehicle" value={value} checked={vehicle === value} disabled={!editable || app.status !== "DRAFT" || busy} onChange={() => setVehicle(value)}/><strong>{name}</strong><span>{description}</span></label>)}</div><h3>Which services would you like to offer?</h3><div className="ra-service-options">{["DELIVERY", "RIDE"].map(service => <label className={`ra-choice ${services.includes(service) ? "is-selected" : ""}`} key={service}><input type="checkbox" disabled={!editable || app.status !== "DRAFT" || busy} checked={services.includes(service)} onChange={e => setServices(e.target.checked ? ["DELIVERY", "RIDE"].filter(s => s === service || services.includes(s)) : services.filter(s => s !== service))}/><strong>{service === "RIDE" ? "Passenger rides" : "Delivery"}</strong><span>{service === "RIDE" ? "Take people to their next stop" : "Bring parcels where they need to go"}</span></label>)}</div><p className="ra-help">Select one or both. Each service requires its own approval. Passenger permits and operating-area requirements depend on the vehicle and location.</p></section>}
      {step === 2 && <section><p className="ra-help">{vehicleName} · {services.map(s => s === "RIDE" ? "Passenger rides" : "Delivery").join(" + ")}. Your name is filled from your account. Complete the remaining details below.</p>{Object.entries(SECTION_FIELDS).map(([section, keys]) => {
        const review = app.fieldReviews[section], locked = !editable || app.status === "NEEDS_CORRECTION" && review?.status !== "NEEDS_CORRECTION";
        return <section className="ra-card" key={section}><div className="ra-section-heading"><h3>{label(section)}</h3><span className="ra-status">{label(review?.status || "PENDING")}</span></div>{review?.reason && <p className="ra-error">{review.reason}</p>}<div className="ra-grid">{visibleFields(keys, vehicle, services).map(key => <label key={key}>{FIELD_LABELS[key]}{key === "ownership" ? <select value={fields[key] || ""} disabled={locked || busy} onChange={e => setFields({ ...fields, [key]: e.target.value })}><option value="">Choose ownership</option><option value="OWNER">Registered owner</option><option value="BORROWED">Borrowed / operated for someone else</option><option value="PURCHASED">Purchased; registration transfer pending</option></select> : <input type={key === "birthDate" || key.endsWith("Expiry") ? "date" : ["vehicleYear", "capacity", "displacement"].includes(key) ? "number" : key === "mobile" || key === "emergencyPhone" ? "tel" : "text"} value={fields[key] || ""} disabled={locked || busy} maxLength={key === "address" ? 1000 : 200} onChange={e => setFields({ ...fields, [key]: e.target.value })}/>}</label>)}</div></section>;
      })}</section>}
      {step === 3 && <section className="ra-card"><h3>Your {vehicleName.toLowerCase()} checklist</h3><p className="ra-help">Readable JPEG, PNG, WebP or unencrypted PDF, up to 3 MB. Profile photos must be images. Each upload is saved immediately. During corrections, replace only flagged items.</p><p className="ra-document-count">{documents.filter(kind => app.documents.some(d => d.current && d.kind === kind && d.status !== "NEEDS_CORRECTION")).length} of {documents.length} required documents uploaded</p>
        {[...documents, ...app.documents.filter(d => d.current && !documents.includes(d.kind)).map(d => d.kind), ...(extra ? ["MEDICAL", "DRUG_TEST"].filter(k => !app.documents.some(d => d.current && d.kind === k)) : [])].filter((k,i,a) => a.indexOf(k) === i).map(kind => {
          const doc = app.documents.find(d => d.current && d.kind === kind), locked = !editable || app.status === "NEEDS_CORRECTION" && (doc ? doc.status !== "NEEDS_CORRECTION" : !documents.includes(kind));
          return <div className="ra-document" key={kind}><div><strong>{DOCUMENT_LABELS[kind]}</strong><span className="ra-status">{doc ? label(doc.status) : "Not uploaded"}</span></div>{doc?.reason && <p className="ra-error">{doc.reason}</p>}{doc && <a href={`${endpoint}?document=${doc.id}`} target="_blank" rel="noreferrer">View current document ↗</a>}{!locked && <label>{doc ? "Replace document" : "Upload document"}<input type="file" accept={kind === "PROFILE" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"} disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void upload(kind, file); }}/></label>}</div>;
        })}{editable && <button onClick={() => setExtra(!extra)}>{extra ? "Hide additional slots" : "Additional medical / drug-test documents, if requested"}</button>}</section>}
      {step === 4 && <>
        {editable && <section className="ra-card"><h3>{issues.length ? "A few things to finish" : "Ready for your review"}</h3><p>{issues.length ? "Complete these requirements before submitting. Select an item to return to its step." : "Check your details below. Submitting sends your application to the reviewing team."}</p>{issues.length > 0 && <ul className="ra-missing">{issues.map((issue, index) => <li key={index}><button disabled={busy} onClick={() => void goTo(issue.step)}>{issue.message} <span aria-hidden="true">↗</span></button></li>)}</ul>}</section>}
        <section className="ra-card"><div className="ra-section-heading"><h3>Vehicle & services</h3>{editable && <button disabled={busy} onClick={() => void goTo(1)}>Edit</button>}</div><p><strong>{vehicleName}</strong> · {services.map(s => s === "RIDE" ? "Passenger rides" : "Delivery").join(" + ")}</p><p className="ra-help">{email} · {app.emailVerifiedAt ? "Email verified" : "Email verification pending"}</p></section>
        {Object.entries(SECTION_FIELDS).map(([section, keys]) => <section className="ra-card" key={section}><div className="ra-section-heading"><h3>{label(section)}</h3>{editable && <button disabled={busy} onClick={() => void goTo(2)}>Edit {label(section).toLowerCase()}</button>}</div><dl className="ra-review-grid">{visibleFields(keys, vehicle, services).map(key => <div key={key}><dt>{FIELD_LABELS[key]}</dt><dd>{key === "ownership" ? ({ OWNER: "Registered owner", BORROWED: "Borrowed / operated for someone else", PURCHASED: "Registration transfer pending" }[fields[key]] ?? "Not provided") : fields[key] || "Not provided"}</dd></div>)}</dl></section>)}
        <section className="ra-card"><div className="ra-section-heading"><h3>Documents</h3><button disabled={busy} onClick={() => void goTo(3)}>{editable ? "Edit documents" : "View documents"}</button></div><ul className="ra-doc-summary">{documents.map(kind => <li key={kind}><span>{DOCUMENT_LABELS[kind]}</span><span>{app.documents.some(d => d.current && d.kind === kind && d.status !== "NEEDS_CORRECTION") ? "✓ Uploaded" : "Needs attention"}</span></li>)}</ul></section>
      </>}
      {app.orientationAt && <section className="ra-card"><h2>Your orientation</h2><p><strong>{new Date(app.orientationAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "short" })} — Philippine time</strong></p><p>{app.orientationVenue}</p><p>{app.orientationInstructions}</p><a className="ra-link-button" href={`${endpoint}?letter=1`}>Download invitation letter (PDF)</a><p className="ra-help">Document acceptance does not activate your account. Attend orientation and complete the required assessments.</p></section>}
      {!editable && <section className="ra-card"><h2>Your next step</h2><p>{app.status === "ACTIVE" ? "Your approved services are listed above. Other requested services may still be awaiting activation." : app.status === "ORIENTATION_SCHEDULED" ? "Attend your scheduled orientation. Your reviewer will record attendance and assessment results." : "Your application is with the reviewing team. Check back here for updates and correction requests."}</p><button disabled={busy} onClick={() => void load()}>Check application status</button></section>}
      {editable && <footer className="ra-actions"><div className="ra-action-secondary">{step > 0 && <button disabled={busy} onClick={() => void goTo((step - 1) as RegistrationStep)}>Back</button>}<button disabled={busy} onClick={() => void goTo(step)}>Save draft</button></div>{step < 4 ? <button className="ra-primary" disabled={busy || step === 0 && !app.emailVerifiedAt} onClick={() => void goTo((step + 1) as RegistrationStep, true)}>Save & continue →</button> : <button className="ra-primary" disabled={busy || issues.length > 0} onClick={() => void perform("submit")}>{app.status === "NEEDS_CORRECTION" ? "Resubmit corrections" : "Submit application"}</button>}</footer>}
      <p className="ra-help">Your documents are private and available only to you and authorized reviewers. Continue or save a draft to keep changes; uploads are saved immediately.</p>
    </>}
  </main>;
}
