"use client";

import { MailCheck, ArrowUpRight, RefreshCw, CalendarDays } from 'lucide-react';
import { useEffect, useRef } from 'react';

type PendingApplication = { id: string; status: string; orientationAt?: string; orientationVenue?: string; orientationInstructions?: string };
const stages: Record<string, [string, string]> = {
  SUBMITTED: ['Application received', 'Check your email for confirmation and updates.'],
  IN_REVIEW: ['Application under review', 'We’ll email you when your review is complete.'],
  RECOMMENDED: ['Documents reviewed', 'Check your email for the next steps for orientation.'],
  ORIENTATION_SCHEDULED: ['Orientation scheduled', 'Check your email for your invitation.'],
  ASSESSED: ['Final approval pending', 'We’ll email you when your services are approved.'],
  FORCE_APPROVAL_PENDING: ['Decision pending', 'We’ll email you with the decision.'],
  DEMO_COMPLETED: ['Service approval pending', 'Your dashboard opens when your services are approved.'],
  REJECTED: ['Application not approved', 'Check your email for the decision and next steps.'],
  ACTIVE: ['Service access needs attention', 'Contact the review team to restore access.'],
};

export function ApplicationWaiting({ application, email, refreshing, error, onRefresh, onSignOut }: {
  application: PendingApplication; email?: string; refreshing: boolean; error: string; onRefresh: () => void; onSignOut: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const [status, description] = stages[application.status] ?? ['Review pending', 'The reviewing team will email you with the next steps.'];
  const hasInvitation = !!application.orientationAt && ['ORIENTATION_SCHEDULED', 'ASSESSED', 'ACTIVE', 'DEMO_COMPLETED'].includes(application.status);
  return <main className="ra ra-pending">
    <header className="ra-header"><a href="/" aria-label="Fetch-It home"><img src="/rider-logo.png" alt="" width="44" height="44"/><strong>Fetch-It<span>Rider</span></strong></a><button type="button" onClick={onSignOut}>Sign out</button></header>
    <section className="ra-pending-card" aria-labelledby="submission-heading">
      <div className="ra-pending-icon" aria-hidden="true"><MailCheck size={30}/></div>
      <div aria-live="polite"><h1 id="submission-heading" ref={heading} tabIndex={-1}>{status}</h1><p className="ra-pending-lead">{description}</p></div>
      {email && <p className="ra-pending-email"><strong>{email}</strong></p>}
      {hasInvitation && <section className="ra-orientation"><h2><CalendarDays size={18} aria-hidden="true"/>Your orientation</h2><strong>{new Date(application.orientationAt!).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short' })} · Philippine time</strong><p>{application.orientationVenue}</p>{application.orientationInstructions && <p>{application.orientationInstructions}</p>}<a href="/api/rider/application?letter=1" target="_blank" rel="noreferrer">Open invitation letter <ArrowUpRight size={16} aria-hidden="true"/></a></section>}
      {error && <p className="ra-error" role="alert">{error}</p>}
      <button className="ra-primary ra-pending-refresh" type="button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true"/>{refreshing ? 'Checking for updates…' : 'Check for updates'}</button>
      <details className="ra-pending-help"><summary>Application details</summary><p>Check your spam folder if you’re missing an email. Return here to make any requested corrections.</p><p className="ra-pending-reference">Reference · {application.id}</p></details>
    </section>
  </main>;
}
