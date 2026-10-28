"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SECTION_FIELDS, FIELD_LABELS, DOCUMENT_LABELS, requiredDocuments, type Fields, type Review } from "@/lib/rider-application-policy";
import { useAppStore } from "@/lib/store";
import { RiderDashboard } from "./rider-dashboard";
import { RegistrationProgress } from './registration-progress';
import { REGISTRATION_STEPS, STEP_KEYS, resumeRegistration, registrationIssues, visibleFields, type RegistrationStep, type RegistrationIssue } from '@/lib/rider-registration';
import { ApplicationPopup } from './application-popup';
import "./rider-application.css";
import { useLocalDemo } from '@/hooks/use-local-demo';
import { useVisiblePoll } from '@/hooks/use-visible-poll';
import { readApplicationJson } from '@/lib/application-client-response';

type Doc = { id: string; kind: string; current: boolean; status: string; reason?: string };
type Application = { isDemo: boolean; id: string; version: number; status: string; vehicleClass: string; services: string[]; fields: Fields; fieldReviews: Record<string, Review>; documents: Doc[]; emailVerifiedAt?: string; orientationAt?: string; orientationVenue?: string; orientationInstructions?: string; emails: { id: string; kind: string; status: string }[] };
type Approval = { service: string; vehicleClass: string; source: string; validUntil?: string };
const label = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
const endpoint = "/api/rider/application";
export function RiderApplicationBoundary() {
  const lab = useLocalDemo();
  const mutationVersion = useRef(0);
  const [demoInbox, setDemoInbox] = useState<{ id: string; subject: string; text: string }[]>([]);
  const email = useAppStore(s => s.user?.email);
  const userId = useAppStore(s => s.user?.id), logout = useAppStore(s => s.logout);
  const [app, setApp] = useState<Application | null>(null), [approvals, setApprovals] = useState<Approval[]>([]), [fields, setFields] = useState<Fields>({}), [vehicle, setVehicle] = useState("MOTORCYCLE"), [services, setServices] = useState(["DELIVERY"]);
  const [working, setWorking] = useState(false), [canWork, setCanWork] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [code, setCode] = useState("");
  const [extra, setExtra] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const [demoProgress, setDemoProgress] = useState('');
  const [popup, setPopup] = useState<{ kind: 'requirements'; issues: RegistrationIssue[] } | { kind: 'status' } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false), [statusError, setStatusError] = useState('');
  const [busyLabel, setBusyLabel] = useState('Saving…');
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer); }, [notice]);
  const [resendUntil, setResendUntil] = useState(0), [resendRemaining, setResendRemaining] = useState(0);
  useEffect(() => {
    if (!resendUntil) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
      setResendRemaining(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendUntil]);
  const [step, setStep] = useState<RegistrationStep>(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const editable = !!app && ["DRAFT", "NEEDS_CORRECTION"].includes(app.status);
  const dirty = !!app && editable && (JSON.stringify(fields) !== JSON.stringify(app.fields) || vehicle !== app.vehicleClass || JSON.stringify(services) !== JSON.stringify(app.services));
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const hydrate = useCallback((a: Application) => { setApp(a); setFields(a.fields); setVehicle(a.vehicleClass); setServices(a.services); }, []);
  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    const startedVersion = mutationVersion.current;
    try {
      const res = await fetch(endpoint, { cache: "no-store", signal }); const data = await readApplicationJson(res);
      if (signal?.aborted || mutationVersion.current !== startedVersion) return;
      if (!res.ok) throw new Error(data.error || "Application unavailable.");
      hydrate(data.application); setApprovals(data.approvals); setCanWork(data.canWork);
      if (initial) { setWorking(data.canWork); setStep(resumeRegistration(data.application)); }
      else if (data.application.status === 'NEEDS_CORRECTION') { setNotice(''); setStep(resumeRegistration(data.application)); }
      else if (!["DRAFT", "NEEDS_CORRECTION"].includes(data.application.status)) setStep(4);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Application unavailable."); } finally { if (!signal?.aborted) setLoading(false); }
  }, [hydrate]);
  useEffect(() => { const controller = new AbortController(); // Initial fetch updates state only after the response; abort prevents stale account data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId) void load(true, controller.signal); return () => controller.abort(); }, [userId, load]);
  useVisiblePoll(app && !editable && !working && !busy && !checkingStatus ? userId || '' : '', signal => load(false, signal), 10000, false);
  async function checkStatus() {
    if (busy || checkingStatus) return;
    setPopup({ kind: 'status' }); setStatusError(''); setCheckingStatus(true); setNotice('');
    const startedVersion = mutationVersion.current;
    try {
      const response = await fetch(endpoint, { cache: 'no-store' }), data = await readApplicationJson(response);
      if (!response.ok) throw Error(data.error || 'Could not check application status.');
      if (mutationVersion.current !== startedVersion) return;
      if (!dirtyRef.current || !['DRAFT', 'NEEDS_CORRECTION'].includes(data.application.status)) hydrate(data.application);
      else setApp(data.application);
      setApprovals(data.approvals); setCanWork(data.canWork);
      if (!['DRAFT', 'NEEDS_CORRECTION'].includes(data.application.status)) setStep(4);
    } catch (e) { setStatusError(e instanceof Error ? e.message : 'Could not check application status.'); }
    finally { setCheckingStatus(false); }
  }
  async function fillDemoStep() {
    if (!app || busy) return;
    if (!lab.enabled && step === 0) {
      if (!app.emailVerifiedAt) await perform('send-code');
      else setNotice('Your own email is verified. Continue to try the demo steps.');
      return;
    }
    setBusy(true); setError(''); setNotice(''); setDemoProgress('Preparing demo…');
    let refreshAfterError = !dirty;
    try {
      let version = app.version;
      if (dirty) { const saved = await request({ action: 'save', fields, vehicleClass: vehicle, services }); version = saved.application.version; refreshAfterError = true; }
      else {
        // A previous request may have saved files before its gateway timed out.
        const latest = await fetch(endpoint, { cache: 'no-store' }), saved = await readApplicationJson(latest);
        if (!latest.ok) throw Error(saved.error || 'Could not refresh saved progress.');
        version = saved.application.version; hydrate(saved.application);
      }
      for (let part = 0; part < 20; part++) {
        const response = await fetch(lab.enabled ? '/api/local-demo' : `${endpoint}/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: ['verify', 'vehicle', 'details', 'documents', 'review'][step], version }) });
        const data = await readApplicationJson(response); if (!response.ok) throw Error(data.error || 'Demo step failed.');
        hydrate(data.application); version = data.application.version;
        if (data.demoProgress) setDemoProgress(`Demo documents · ${data.demoProgress.completed} of ${data.demoProgress.total} saved`);
        if (!data.demoContinue) { setNotice('Demo data saved. Review it, then continue normally.'); return; }
      }
      throw Error('Some demo documents are still pending. Try again to resume saved progress.');
    } catch (e) {
      if (refreshAfterError) await load(false);
      setError(e instanceof Error ? e.message : 'Demo step failed.');
    } finally { setBusy(false); setDemoProgress(''); }
  }
  async function showLocalInbox() {
    try { const response = await fetch('/api/local-demo?inbox=1', { cache: 'no-store' }); const data = await readApplicationJson(response); if (!response.ok) throw Error('Local inbox unavailable.'); setDemoInbox(data.messages); }
    catch (e) { setError(e instanceof Error ? e.message : 'Local inbox unavailable.'); }
  }

  async function request(body: Record<string, unknown>) {
    mutationVersion.current++;
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: app?.version, ...body }) });
    const result = await readApplicationJson(res);
    if (body.action === "send-code" && (res.ok || res.status === 429)) {
      const retry = res.ok ? 60 : Number(res.headers.get("Retry-After") || 60);
      const seconds = Number.isFinite(retry) && retry > 0 ? Math.min(Math.ceil(retry), 86400) : 60;
      setResendRemaining(seconds); setResendUntil(Date.now() + seconds * 1000);
    }
    if (!res.ok) throw new Error(result.error || "Could not save your application.");
    if (result.application) hydrate(result.application); return result;
  }
  async function perform(action: string) {
    if (busy || action === "send-code" && resendRemaining > 0) return;
    if (action === 'submit' && app) {
      const missing = registrationIssues(app, vehicle, services, fields);
      if (missing.length) { setPopup({ kind: 'requirements', issues: missing }); return; }
    }
    setBusyLabel(action === 'submit' ? 'Submitting application…' : action === 'send-code' ? 'Sending verification code…' : action === 'verify-code' ? 'Verifying email…' : 'Saving…');
    setBusy(true); setError(""); setNotice("");
    try {
      await request({ action, fields, vehicleClass: vehicle, services, code });
      setNotice(action === "submit" ? "" : action === "send-code" ? "Code sent. Check your inbox and spam folder." : action === "verify-code" ? "Email verified." : "Draft saved.");
      if (action === "verify-code") { setCode(""); setStep(1); }
      if (action === "submit") { setStep(4); setPopup({ kind: 'status' }); }
      if (action === 'demo-enable' || action === 'demo-reset') { setStep(1); setConfirmReal(false); setNotice(action === 'demo-enable' ? 'Demo started. Your verified email will receive real demo review messages.' : 'Real application started. Upload your actual documents for a fresh review.'); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your application."); } finally { setBusy(false); }
  }
  async function upload(kind: string, file?: File) {
    if (!file || !app || busy) return;
    setBusyLabel(`Uploading ${DOCUMENT_LABELS[kind].toLowerCase()}…`);
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error("Choose a file up to 3 MB.");
      const version = dirty ? (await request({ action: "save", fields, vehicleClass: vehicle, services })).application.version : app.version;
      const form = new FormData(); form.set("file", file); form.set("kind", kind); form.set("version", String(version));
      if (kind === "NBI" && fields.nbiExpiry) form.set("expiresAt", fields.nbiExpiry);
      if (kind.startsWith("LICENCE") && fields.licenceExpiry) form.set("expiresAt", fields.licenceExpiry);
      mutationVersion.current++;
      const res = await fetch(endpoint, { method: "POST", body: form }); const result = await readApplicationJson(res);
      if (!res.ok) throw new Error(result.error || "Upload failed."); hydrate(result.application); setNotice(`${DOCUMENT_LABELS[kind]} uploaded for review.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); } finally { setBusy(false); }
  }
  async function removeDocument(doc: Doc) {
    if (!app || busy) return;
    setBusyLabel('Removing upload…');
    setBusy(true); setError(""); setNotice("");
    try {
      const version = dirty ? (await request({ action: "save", fields, vehicleClass: vehicle, services })).application.version : app.version;
      const result = await request({ action: "remove-document", documentId: doc.id, version });
      const restored = result.application.documents.some((d: Doc) => d.current && d.kind === doc.kind);
      setNotice(`${DOCUMENT_LABELS[doc.kind]} upload removed.${restored ? " The previous correction and feedback are restored." : " You can choose another file."}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove this upload."); } finally { setBusy(false); }
  }
  async function goTo(next: RegistrationStep, validate = false, exit = false) {
    if (!app || busy) return;
    if (next > 0 && !app.emailVerifiedAt) { setPopup({ kind: 'requirements', issues: [{ step: 0, message: 'Verify your email to continue.' }] }); return; }
    if (validate) {
      const missing = registrationIssues(app, vehicle, services, fields).filter(item => item.step === step);
      if (missing.length) { setPopup({ kind: 'requirements', issues: missing }); return; }
    }
    setBusyLabel('Saving…'); setBusy(true); setError(""); setNotice("");
    try {
      if (editable && dirty) await request({ action: "save", fields: { ...fields, registrationStep: STEP_KEYS[Math.max(1, next)] }, vehicleClass: vehicle, services });
      if (exit) { await logout(); return; }
      setStep(next); if (next === step && editable) setNotice('All changes are saved.');
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your progress."); } finally { setBusy(false); }
  }
  if (loading) return <main className="ra"><p role="status">Loading your rider application…</p></main>;
  if (working && canWork) return <><div className="ra-work-link"><button onClick={() => { setWorking(false); void load(); }}>Application & service approvals</button></div><RiderDashboard/></>;
  const documents = requiredDocuments(vehicle, services, fields);
  const issues = app ? registrationIssues(app, vehicle, services, fields) : [];
  const vehicleName = vehicle === "SEDAN" ? "Car" : label(vehicle);
  return <main className="ra"><header className="ra-header"><a href="/" aria-label="Fetch-It home"><img src="/rider-logo.png" alt="" width="44" height="44"/><strong>Fetch-It <span>Rider registration</span></strong></a><button disabled={busy} onClick={() => { if (editable) void goTo(step, false, true); else void logout(); }}>{editable ? "Save & exit" : "Sign out"}</button></header>
    <div className="ra-intro"><p className="ra-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h1>{editable ? <>Your road.<br/>One step at a time.</> : <>Your application,<br/>at a glance.</>}</h1><p>{editable ? "One application. A clear checklist. Pick up where you left off." : "Review your saved details here. Open application status for the latest update."}</p>{app && <button disabled={busy || checkingStatus} onClick={() => void checkStatus()}>Check application status</button>}</div>
    {lab.enabled && <aside className="ra-card" style={{ borderColor: '#c87338' }}><strong>LOCAL DEMO LAB · Lingayen–Dagupan</strong><p>Isolated test data. Sample documents are not valid credentials. Emails are captured here and never sent.</p><div className="ra-inline">{editable && <button disabled={busy || step === 1 && app?.status !== 'DRAFT'} onClick={() => void fillDemoStep()}>{`Use demo · ${REGISTRATION_STEPS[step]}`}</button>}<button onClick={() => void showLocalInbox()}>Local email inbox</button><a href={lab.adminUrl} target="_blank" rel="noreferrer">Open connected Admin ↗</a></div>{demoInbox.map(mail => <details key={mail.id}><summary>{mail.subject}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{mail.text}</p></details>)}</aside>}
    {!lab.enabled && app?.isDemo && <aside className="ra-card" style={{ borderColor: '#c87338' }}><strong>FOR DEMO · Lingayen–Dagupan</strong><p>Try each application step with sample data. Your application is connected to the live reviewing team. Verification, correction and orientation messages are sent to <strong>{email}</strong>; review emails are labeled DEMO.</p><p>Sample documents cannot activate real rider services.</p>{editable && <button disabled={busy || step === 0 && !app.emailVerifiedAt && resendRemaining > 0 || step === 1 && app.status !== 'DRAFT'} onClick={() => void fillDemoStep()}>{`Use demo · ${REGISTRATION_STEPS[step]}`}</button>}<details><summary>Ready to apply for real?</summary><p>Keep this account and verified email. Demo uploads and reviews will be archived. Your earlier real draft details are restored when available; real approval requires fresh documents.</p><label className="ra-inline"><input type="checkbox" checked={confirmReal} onChange={e => setConfirmReal(e.target.checked)}/>I want to start a real application with fresh documents.</label><button disabled={busy || !confirmReal} onClick={() => void perform('demo-reset')}>Start real application</button></details></aside>}
    {!lab.enabled && app && !app.isDemo && app.status === 'DRAFT' && !canWork && !app.documents.some(d => d.current) && <aside className="ra-card"><strong>Want to try the application first?</strong><p>Use demo details and sample documents, with real review emails to your own verified address.</p><button disabled={busy || !app.emailVerifiedAt} onClick={() => void perform('demo-enable')}>Use demo · start application demo</button>{!app.emailVerifiedAt && <p>Verify your email to unlock the demo.</p>}</aside>}
    {notice && <div role="status" className="ra-toast"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {!app && <button onClick={() => void load(true)}>Retry loading</button>}
    {app && <>
      <RegistrationProgress step={step} verified={!!app.emailVerifiedAt} busy={busy} onSelect={next => void goTo(next)}/>
      <div className="ra-step-heading"><p className="ra-eyebrow">STEP {step + 1} OF 5</p><h2 ref={heading} tabIndex={-1}>{REGISTRATION_STEPS[step]}</h2><span className="ra-save-state" role="status">{busy ? demoProgress || busyLabel : dirty ? "Unsaved changes · save before leaving" : "Your progress is saved"}</span></div>
      {step === 0 && <section className="ra-card"><h3>Verify your email</h3><p>Your account is created. We’ll use <strong>{email}</strong> for application updates.</p>{app.emailVerifiedAt ? <><p className="ra-success">✓ Email verified</p><p>Your account details are saved. Continue to your vehicle and services.</p></> : <><p className="ra-help">Send a six-digit code to this address, then enter it below. You can sign in later to continue.</p><div className="ra-inline"><button disabled={busy || resendRemaining > 0} onClick={() => void perform("send-code")}>{resendRemaining > 0 ? `Resend available in ${resendRemaining}s` : "Send verification code"}</button><label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}/></label><button disabled={busy || code.length !== 6} onClick={() => void perform("verify-code")}>Verify email & continue</button></div></>}</section>}
      {step === 1 && <section className="ra-card"><h3>What will you drive?</h3><p className="ra-help">Choose your vehicle once. Your details and document checklist will adapt to it.</p><div className="ra-vehicle-options">{[["MOTORCYCLE", "Motorcycle", "Two-wheel journeys"], ["TRICYCLE", "Tricycle", "Local trips and deliveries"], ["SEDAN", "Car", "More room for the road"]].map(([value, name, description]) => <label key={value} className={`ra-choice ${vehicle === value ? "is-selected" : ""}`}><input type="radio" name="application-vehicle" value={value} checked={vehicle === value} disabled={!editable || app.status !== "DRAFT" || busy} onChange={() => setVehicle(value)}/><strong>{name}</strong><span>{description}</span></label>)}</div><h3>Which services would you like to offer?</h3><div className="ra-service-options">{["DELIVERY", "RIDE"].map(service => <label className={`ra-choice ${services.includes(service) ? "is-selected" : ""}`} key={service}><input type="checkbox" disabled={!editable || app.status !== "DRAFT" || busy} checked={services.includes(service)} onChange={e => setServices(e.target.checked ? ["DELIVERY", "RIDE"].filter(s => s === service || services.includes(s)) : services.filter(s => s !== service))}/><strong>{service === "RIDE" ? "Passenger rides" : "Delivery"}</strong><span>{service === "RIDE" ? "Take people to their next stop" : "Bring parcels where they need to go"}</span></label>)}</div><p className="ra-help">Select one or both. Each service requires its own approval. Passenger permits and operating-area requirements depend on the vehicle and location.</p></section>}
      {step === 2 && <section><p className="ra-help">{vehicleName} · {services.map(s => s === "RIDE" ? "Passenger rides" : "Delivery").join(" + ")}. Your name is filled from your account. Complete the remaining details below.</p>{Object.entries(SECTION_FIELDS).map(([section, keys]) => {
        const review = app.fieldReviews[section], locked = !editable || app.status === "NEEDS_CORRECTION" && review?.status !== "NEEDS_CORRECTION";
        return <section className="ra-card" key={section}><div className="ra-section-heading"><h3>{label(section)}</h3><span className="ra-status">{label(review?.status || "PENDING")}</span></div>{review?.reason && <p className="ra-error">{review.reason}</p>}<div className="ra-grid">{visibleFields(keys, vehicle, services).map(key => <label key={key}>{FIELD_LABELS[key]}{key === "ownership" ? <select value={fields[key] || ""} disabled={locked || busy} onChange={e => setFields({ ...fields, [key]: e.target.value })}><option value="">Choose ownership</option><option value="OWNER">Registered owner</option><option value="BORROWED">Borrowed / operated for someone else</option><option value="PURCHASED">Purchased; registration transfer pending</option></select> : <input type={key === "birthDate" || key.endsWith("Expiry") ? "date" : ["vehicleYear", "capacity", "displacement"].includes(key) ? "number" : key === "mobile" || key === "emergencyPhone" ? "tel" : "text"} value={fields[key] || ""} disabled={locked || busy} maxLength={key === "address" ? 1000 : 200} onChange={e => setFields({ ...fields, [key]: e.target.value })}/>}</label>)}</div></section>;
      })}</section>}
      {step === 3 && <section className="ra-card"><h3>Your {vehicleName.toLowerCase()} checklist</h3><p className="ra-help">Readable JPEG, PNG, WebP or unencrypted PDF, up to 3 MB. Profile photos must be images. Each upload is saved immediately. During corrections, replace only flagged items.</p><p className="ra-document-count">{documents.filter(kind => app.documents.some(d => d.current && d.kind === kind && d.status !== "NEEDS_CORRECTION")).length} of {documents.length} required documents uploaded</p>
        {[...documents, ...app.documents.filter(d => d.current && !documents.includes(d.kind)).map(d => d.kind), ...(extra ? ["MEDICAL", "DRUG_TEST"].filter(k => !app.documents.some(d => d.current && d.kind === k)) : [])].filter((k,i,a) => a.indexOf(k) === i).map(kind => {
          const doc = app.documents.find(d => d.current && d.kind === kind), locked = !editable || app.status === "NEEDS_CORRECTION" && (doc ? doc.status !== "NEEDS_CORRECTION" : !documents.includes(kind));
          return <div className="ra-document" key={kind}><div><strong>{DOCUMENT_LABELS[kind]}</strong><span className="ra-status">{doc ? label(doc.status) : "Not uploaded"}</span></div>{doc?.reason && <p className="ra-error">{doc.reason}</p>}{doc && <div className="ra-document-file"><a href={`${endpoint}?document=${doc.id}`} target="_blank" rel="noreferrer">View current document ↗</a>{editable && doc.status === "PENDING" && <button type="button" className="ra-remove-document" disabled={busy} aria-label={`Remove ${DOCUMENT_LABELS[kind]} upload`} title="Remove uploaded file" onClick={() => void removeDocument(doc)}><span aria-hidden="true">×</span></button>}</div>}{!locked && <label>{doc ? "Replace document" : "Upload document"}<input type="file" accept={kind === "PROFILE" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"} disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void upload(kind, file); }}/></label>}</div>;
        })}{editable && <button onClick={() => setExtra(!extra)}>{extra ? "Hide additional slots" : "Additional medical / drug-test documents, if requested"}</button>}</section>}
      {step === 4 && <>
        {editable && <section className="ra-card"><h3>Review your application</h3><p>Check your details and documents before sending them to the reviewing team.</p><button disabled={busy} onClick={() => setPopup({ kind: 'requirements', issues })}>Check requirements</button></section>}
        <section className="ra-card"><div className="ra-section-heading"><h3>Vehicle & services</h3>{editable && <button disabled={busy} onClick={() => void goTo(1)}>Edit</button>}</div><p><strong>{vehicleName}</strong> · {services.map(s => s === "RIDE" ? "Passenger rides" : "Delivery").join(" + ")}</p><p className="ra-help">{email} · {app.emailVerifiedAt ? "Email verified" : "Email verification pending"}</p></section>
        {Object.entries(SECTION_FIELDS).map(([section, keys]) => <section className="ra-card" key={section}><div className="ra-section-heading"><h3>{label(section)}</h3>{editable && <button disabled={busy} onClick={() => void goTo(2)}>Edit {label(section).toLowerCase()}</button>}</div><dl className="ra-review-grid">{visibleFields(keys, vehicle, services).map(key => <div key={key}><dt>{FIELD_LABELS[key]}</dt><dd>{key === "ownership" ? ({ OWNER: "Registered owner", BORROWED: "Borrowed / operated for someone else", PURCHASED: "Registration transfer pending" }[fields[key]] ?? "Not provided") : fields[key] || "Not provided"}</dd></div>)}</dl></section>)}
        <section className="ra-card"><div className="ra-section-heading"><h3>Documents</h3><button disabled={busy} onClick={() => void goTo(3)}>{editable ? "Edit documents" : "View documents"}</button></div><ul className="ra-doc-summary">{documents.map(kind => <li key={kind}><span>{DOCUMENT_LABELS[kind]}</span><span>{app.documents.some(d => d.current && d.kind === kind && d.status !== "NEEDS_CORRECTION") ? "✓ Uploaded" : "Needs attention"}</span></li>)}</ul></section>
      </>}
      {editable && <footer className="ra-actions"><div className="ra-action-secondary">{step > 0 && <button disabled={busy} onClick={() => void goTo((step - 1) as RegistrationStep)}>Back</button>}<button disabled={busy} onClick={() => void goTo(step)}>Save draft</button></div>{step < 4 ? <button className="ra-primary" disabled={busy} onClick={() => void goTo((step + 1) as RegistrationStep, true)}>Save & continue →</button> : <button className="ra-primary" disabled={busy} onClick={() => void perform("submit")}>{busy ? busyLabel : app.status === "NEEDS_CORRECTION" ? "Resubmit corrections" : "Submit application"}</button>}</footer>}
      <p className="ra-help">Your documents are private and available only to you and authorized reviewers. Continue or save a draft to keep changes; uploads are saved immediately.</p>
    </>}
    <ApplicationPopup open={!!error || !!popup} onClose={() => { setError(''); setPopup(null); }} title={error ? 'Please check this' : popup?.kind === 'status' ? 'Application status' : popup?.kind === 'requirements' && !popup.issues.length ? 'Requirements complete' : 'A few things to finish'} description={error ? 'Your saved progress is kept.' : popup?.kind === 'status' ? 'Your latest review, corrections and orientation details.' : 'Select a requirement to return to its step.'}>
      {error ? <><p role="alert">{error}</p><button onClick={() => setError('')}>Back to application</button></> : popup?.kind === 'requirements' ? <>{popup.issues.length ? <ul className="ra-missing">{popup.issues.map((issue, index) => <li key={index}><button onClick={() => { setPopup(null); void goTo(issue.step); }}><span>{issue.message}</span><span aria-hidden="true">↗</span></button></li>)}</ul> : <p>Your checklist is complete. Review your details, then submit when ready.</p>}</> : popup?.kind === 'status' && app && <>
        {checkingStatus && <p role="status">Checking latest status…</p>}
        {statusError && <div role="alert"><p>{statusError}</p><button onClick={() => void checkStatus()}>Try again</button></div>}
        <strong className="ra-status-large">{label(app.status)}</strong>
        <p>{app.status === 'DRAFT' ? 'Your application has not been submitted. Finish your checklist when ready.' : app.status === 'NEEDS_CORRECTION' ? 'Replace the flagged documents or update the details below, then resubmit.' : app.status === 'DEMO_COMPLETED' ? 'Your demo is complete. No real rider services were activated.' : app.status === 'ACTIVE' ? 'Your approved services are listed below.' : app.status === 'ORIENTATION_SCHEDULED' ? 'Attend your scheduled orientation and complete the required assessments.' : 'Your application is with the reviewing team. We will notify you about updates.'}</p>
        {app.status === 'NEEDS_CORRECTION' && <ul className="ra-missing">{registrationIssues(app, vehicle, services, fields).filter(issue => issue.message.startsWith('Replace') || issue.message.startsWith('Correct')).map((issue, index) => <li key={index}><button onClick={() => { setPopup(null); void goTo(issue.step); }}>{issue.message} ↗</button></li>)}</ul>}
        {app.orientationAt && <section><h3>Your orientation</h3><p><strong>{new Date(app.orientationAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short' })} — Philippine time</strong></p><p>{app.orientationVenue}</p><p>{app.orientationInstructions}</p><a href={`${endpoint}?letter=1`}>Download invitation letter (PDF)</a></section>}
        {approvals.length > 0 && <section><h3>Current service access</h3>{approvals.map((a, i) => <p key={i}><strong>{label(a.vehicleClass)} · {label(a.service)}</strong><br/><small>{a.source === 'LEGACY_EXISTING' ? 'Existing rider access; not a document-verification badge.' : `Approved${a.validUntil ? ' until ' + new Date(a.validUntil).toLocaleDateString('en-PH') : ''}`}</small></p>)}</section>}
        {canWork && <button className="ra-primary" onClick={() => { setPopup(null); setWorking(true); }}>Open rider dashboard</button>}
      </>}
    </ApplicationPopup>
  </main>;
}
