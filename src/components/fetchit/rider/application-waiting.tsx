"use client";

import { MailCheck, ArrowUpRight, RefreshCw, CalendarDays } from 'lucide-react';
import { useEffect, useRef } from 'react';

type PendingApplication = { id: string; status: string; orientationAt?: string; orientationVenue?: string; orientationInstructions?: string };
const stages: Record<string, [string, string]> = {
  SUBMITTED: ['Application received', 'Your details and documents are safely submitted to the reviewing team.'],
  IN_REVIEW: ['Under review', 'The team is checking your details and documents. You do not need to submit them again.'],
  RECOMMENDED: ['Documents reviewed', 'The team will email you with the next steps for orientation.'],
  ORIENTATION_SCHEDULED: ['Orientation scheduled', 'Your orientation details are below. Check your email for your invitation and instructions.'],
  ASSESSED: ['Final approval pending', 'Your assessment is recorded. The team will confirm your approved services by email.'],
  FORCE_APPROVAL_PENDING: ['Admin decision pending', 'Your application is awaiting an Admin decision. We will email you with the outcome.'],
  DEMO_COMPLETED: ['Service approval pending', 'Your review is complete. Admin needs to confirm your selected services before your dashboard opens.'],
  REJECTED: ['Application not approved', 'Check your email for the review decision and the next steps provided by the team.'],
  ACTIVE: ['Service access needs attention', 'Your application is approved, but no current service access is available. Contact the reviewing team for assistance.'],
};

export function ApplicationWaiting({ application, email, refreshing, error, onRefresh, onSignOut }: {
  application: PendingApplication; email?: string; refreshing: boolean; error: string; onRefresh: () => void; onSignOut: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const [status, description] = stages[application.status] ?? ['Review pending', 'The reviewing team will email you with the next steps.'];
  const title = application.status === 'REJECTED' || application.status === 'ACTIVE' ? 'Check your application update.' : 'You’re all set for now.';
  const hasInvitation = !!application.orientationAt && ['ORIENTATION_SCHEDULED', 'ASSESSED', 'ACTIVE', 'DEMO_COMPLETED'].includes(application.status);
  return <main className="ra ra-pending">
    <header className="ra-header"><a href="/" aria-label="Fetch-It home"><img src="/rider-logo.png" alt="" width="44" height="44"/><strong>Fetch-It<span>Rider</span></strong></a><button type="button" onClick={onSignOut}>Sign out</button></header>
    <section className="ra-pending-card" aria-labelledby="submission-heading">
      <div className="ra-pending-icon" aria-hidden="true"><MailCheck size={30}/></div>
      <p className="ra-eyebrow">RIDER APPLICATION</p>
      <h1 id="submission-heading" ref={heading} tabIndex={-1}>{title}</h1>
      <p className="ra-pending-lead">Check your email for confirmation and updates.</p>
      <div className="ra-pending-email"><span>Application updates go to</span><strong>{email || 'your registered email address'}</strong></div>
      <div className="ra-review-state" aria-live="polite"><span className="ra-status">{status}</span><p>{description}</p></div>
      {hasInvitation && <section className="ra-orientation"><h2><CalendarDays size={18} aria-hidden="true"/>Your orientation</h2><strong>{new Date(application.orientationAt!).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short' })} · Philippine time</strong><p>{application.orientationVenue}</p>{application.orientationInstructions && <p>{application.orientationInstructions}</p>}<a href="/api/rider/application?letter=1" target="_blank" rel="noreferrer">Open invitation letter <ArrowUpRight size={16} aria-hidden="true"/></a></section>}
      {error && <p className="ra-error" role="alert">{error}</p>}
      <button className="ra-primary ra-pending-refresh" type="button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true"/>{refreshing ? 'Checking for updates…' : 'Check for updates'}</button>
      <p className="ra-pending-help">Check your inbox and spam folder. You can close this page; your submission is saved. If corrections are requested, the required application steps will reopen here.</p>
      <p className="ra-pending-reference">Reference · {application.id}</p>
    </section>
  </main>;
}
