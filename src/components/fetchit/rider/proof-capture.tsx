'use client';
import { startBookingTiming } from '@/lib/booking-client-timing';
import { savedMutation } from '@/lib/booking-mutation-client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, Camera, Loader2, PenTool, ShieldCheck, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { prepareDeliveryPhoto } from '@/lib/epod-photo-client';
import { SignaturePad } from '../shared/signature-pad';
import { SlowRequestFeedback } from '../shared/slow-request-feedback';
import { readProofDraft, saveProofDraft, removeProofDraft } from '@/lib/proof-drafts';

export type ProofState = { busy: boolean; preparing: boolean; hasSignature: boolean; hasPhoto: boolean; unsafe?: boolean };

export function ProofCapture({ bookingId, ownerId, photoAlreadySaved = false, disabled = false, onActionFailure, onDone, onProofState }: {
  bookingId: string; ownerId: string; photoAlreadySaved?: boolean; disabled?: boolean; onActionFailure?: () => void;
  onDone: (completed: boolean) => void; onProofState: (state: ProofState) => void;
}) {
  const { toast } = useToast();
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false), [saved, setSaved] = useState(false);
  const [draftMessage, setDraftMessage] = useState('Checking for a saved proof draft…');
  const [phase, setPhase] = useState(''), [padVersion, setPadVersion] = useState(0);
  const [saveRetry, setSaveRetry] = useState(0);
  const draftVersion = useRef(0), completed = useRef(false);
  const lastSnapshot = useRef('');
  const fileRef = useRef<HTMLInputElement>(null), proofPending = useRef(false), photoPending = useRef(false);
  const proofAttempt = useRef<{ body: string; key: string } | null>(null);
  const hasDraft = !!(signatureSvg || photoDataUrl || recipientName);
  const body = JSON.stringify({ signatureSvg, photoDataUrl: photoDataUrl || undefined, recipientName: recipientName || undefined });
  useEffect(() => {
    let cancelled = false;
    void readProofDraft(ownerId, bookingId).then(draft => {
      if (cancelled) return;
      if (draft) {
        setSignatureSvg(draft.signatureSvg); setPhotoDataUrl(draft.photoDataUrl);
        setPhotoName(draft.photoName); setRecipientName(draft.recipientName);
        lastSnapshot.current = JSON.stringify([draft.signatureSvg, draft.photoDataUrl, draft.photoName, draft.recipientName]);
        if (draft.attemptKey) proofAttempt.current = { key: draft.attemptKey, body: JSON.stringify({ signatureSvg: draft.signatureSvg, photoDataUrl: draft.photoDataUrl || undefined, recipientName: draft.recipientName || undefined }) };
        setSaved(true); setDraftMessage('Unfinished proof restored from this device. Review it before completing delivery.');
      } else setDraftMessage('');
    }).catch(() => { if (!cancelled) setDraftMessage('Device storage is unavailable. Keep this page open until proof is submitted.'); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; draftVersion.current++; };
  }, [ownerId, bookingId]);
  useEffect(() => {
    if (!loaded || completed.current) return;
    const snapshot = JSON.stringify([signatureSvg, photoDataUrl, photoName, recipientName]);
    if (snapshot === lastSnapshot.current || !hasDraft && !lastSnapshot.current) return;
    const version = ++draftVersion.current;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setSaved(false); setDraftMessage('Saving proof on this device…'); } });
    const request = hasDraft ? saveProofDraft({ ownerId, bookingId, signatureSvg, photoDataUrl, photoName, recipientName, savedAt: Date.now(), attemptKey: proofAttempt.current?.body === body ? proofAttempt.current.key : null }) : removeProofDraft(ownerId, bookingId).then(() => true);
    void request.then(stored => {
      if (cancelled || version !== draftVersion.current) return;
      if (!stored) throw new Error('Draft no longer active');
      lastSnapshot.current = snapshot; setSaved(true);
      setDraftMessage(hasDraft ? 'Proof saved on this device for up to 24 hours. It has not been submitted.' : 'Proof draft removed from this device.');
    }).catch(() => { if (!cancelled && version === draftVersion.current) setDraftMessage('Couldn’t save proof on this device. Keep this page open and retry saving.'); });
    return () => { cancelled = true; };
  }, [loaded, ownerId, bookingId, signatureSvg, photoDataUrl, photoName, recipientName, hasDraft, body, saveRetry]);
  useEffect(() => {
    onProofState({ busy: submitting || processingPhoto || !loaded, preparing: processingPhoto, hasSignature: !!signatureSvg, hasPhoto: !!photoDataUrl || photoAlreadySaved, unsafe: submitting || processingPhoto || (hasDraft && !saved) });
  }, [submitting, processingPhoto, signatureSvg, photoDataUrl, photoAlreadySaved, onProofState, loaded, hasDraft, saved]);

  async function clearCompletedDraft() {
    completed.current = true; draftVersion.current++;
    await removeProofDraft(ownerId, bookingId).catch(() => {});
  }
  async function discard() {
    if (!window.confirm('Discard this saved proof? You will need a new signature and photo. Your booking is kept.')) return;
    draftVersion.current++;
    try {
      await removeProofDraft(ownerId, bookingId);
      setSignatureSvg(null); setPhotoDataUrl(null); setPhotoName(''); setRecipientName(''); proofAttempt.current = null;
      lastSnapshot.current = JSON.stringify([null, null, '', '']);
      setPadVersion(value => value + 1); setSaved(true); setDraftMessage('Proof draft discarded.'); setError('');
    } catch { setError('Couldn’t discard the saved draft. Please retry.'); }
  }

  async function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || photoPending.current || proofPending.current) return;
    photoPending.current = true; setProcessingPhoto(true); setPhotoError('');
    try { const prepared = await prepareDeliveryPhoto(file); setPhotoDataUrl(prepared); setPhotoName(file.name); }
    catch (failure) { setPhotoError(failure instanceof Error ? failure.message : 'Couldn’t prepare this photo. Choose another image.'); }
    finally { photoPending.current = false; setProcessingPhoto(false); }
  }

  async function submit() {
    if (disabled || !loaded || proofPending.current || photoPending.current) return;
    setError('');
    if (!signatureSvg || (!photoDataUrl && !photoAlreadySaved)) { setError('Add the recipient signature and a drop-off photo before completing delivery.'); return; }
    proofPending.current = true; setSubmitting(true);
    const timing = startBookingTiming('proof_submit');
    let outcome: 'confirmed' | 'recovered' | 'failed' | 'uncertain' = 'uncertain';
    let uncertain = true;
    if (proofAttempt.current?.body !== body) proofAttempt.current = { body, key: crypto.randomUUID() };
    try {
      setPhase('Saving proof before upload…');
      await saveProofDraft({ ownerId, bookingId, signatureSvg, photoDataUrl, photoName, recipientName, savedAt: Date.now(), attemptKey: proofAttempt.current.key }).catch(() => false);
      setPhase('Uploading proof and confirming delivery…');
      const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/proof`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...timing.headers, 'Idempotency-Key': proofAttempt.current.key }, signal: AbortSignal.timeout(45000), body,
      });
      timing.response(response); uncertain = response.ok || response.status >= 500;
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.proofs)) throw new Error(data?.error || 'Couldn’t confirm delivery. Your proof is still here. Check the job status before retrying.');
      const completed = data.proofs.some((proof: { verified: boolean }) => proof.verified);
      outcome = 'confirmed';
      await clearCompletedDraft();
      toast({ title: completed ? 'Delivery completed' : 'Supporting proof saved', description: completed ? 'Review the booking summary or return to jobs.' : 'Your booking has been updated.' });
      onDone(completed);
    } catch (failure) {
      if (uncertain) {
        setPhase('Checking whether your delivery was already completed…');
        const saved = await savedMutation<{ booking: { id: string; status: string } }>(`/api/bookings/${encodeURIComponent(bookingId)}`, state => state.booking?.id === bookingId && state.booking.status === 'DELIVERED');
        if (saved) { outcome = 'recovered'; await clearCompletedDraft(); toast({ title: 'Delivery completed', description: 'Your saved booking confirms completion.' }); onDone(true); return; }
      }
      outcome = uncertain ? 'uncertain' : 'failed';
      setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'Delivery confirmation timed out. Your proof is still here. Check the job status before retrying.');
      onActionFailure?.();
    } finally { proofPending.current = false; setSubmitting(false); setPhase(''); timing.finish(outcome); }
  }

  return <Card className="border-2 border-primary/30 bg-primary/5">
    <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true"/> Delivery proof</CardTitle><CardDescription>Collect the recipient’s signature and a drop-off photo.</CardDescription></CardHeader>
    <CardContent className="space-y-4 min-w-0 [&>*]:min-w-0">
      {draftMessage && <p role="status" className="rd-help">{draftMessage}</p>}
      {loaded && hasDraft && !saved && !submitting && draftMessage.startsWith('Couldn’t') && <Button type="button" variant="outline" onClick={() => { lastSnapshot.current = ''; setSaveRetry(value => value + 1); }}>Retry saving draft</Button>}
      {!loaded ? <p role="status">Loading proof details…</p> : <form id={`delivery-proof-${bookingId}`} className="space-y-4" aria-busy={submitting} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="space-y-2" inert={submitting || undefined}><Label className="text-sm font-medium flex items-center gap-1.5"><PenTool className="h-4 w-4 text-primary" aria-hidden="true"/> Recipient signature</Label><SignaturePad key={padVersion} defaultValue={signatureSvg ?? ''} onChange={setSignatureSvg}/></div>
        <div className="space-y-2"><Label htmlFor={`recipient-${bookingId}`}>Recipient name (optional)</Label><Input id={`recipient-${bookingId}`} placeholder="Recipient’s name" value={recipientName} disabled={submitting} onChange={event => setRecipientName(event.target.value)}/></div>
        <div className="space-y-2" aria-busy={processingPhoto}>
          <Label className="text-sm font-medium flex items-center gap-1.5"><Camera className="h-4 w-4 text-primary" aria-hidden="true"/> Drop-off photo</Label>
          {photoAlreadySaved && !photoDataUrl && <p className="rd-help">A drop-off photo is already saved.</p>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onPhotoChange} disabled={submitting || processingPhoto} className="hidden" aria-label="Choose drop-off photo"/>
          {photoDataUrl ? <div className="space-y-2"><div className="relative"><img src={photoDataUrl} alt="Drop-off photo preview" className="rounded-lg border w-full h-40 object-contain bg-white"/><Button type="button" size="icon" variant="outline" className="absolute top-1 right-1 h-12 w-12 bg-card" aria-label="Remove selected drop-off photo" disabled={submitting || processingPhoto} onClick={() => { setPhotoDataUrl(null); setPhotoName(''); setPhotoError(''); }}><X size={20} aria-hidden="true"/></Button></div><p className="rd-help break-all">{photoName} · Ready to upload</p></div> : <Button type="button" variant="outline" className="w-full border-dashed min-h-20 whitespace-normal" onClick={() => fileRef.current?.click()} disabled={submitting || processingPhoto}>{processingPhoto ? <Loader2 size={20} className="animate-spin" aria-hidden="true"/> : <Upload size={20} aria-hidden="true"/>}{processingPhoto ? 'Preparing photo…' : photoAlreadySaved ? 'Replace saved photo' : 'Take or choose a photo'}</Button>}
          {processingPhoto && <p className="rd-help" role="status">Optimizing the image on this device. You can still add the signature and recipient name.</p>}
          {photoError && <p className="text-sm text-destructive" role="alert">{photoError}</p>}
          <p className="rd-help">If camera access is blocked, allow Camera in your browser’s site settings, or choose an existing photo.</p>
        </div>
        {submitting && <p className="rd-proof-status" role="status"><Loader2 size={20} className="animate-spin" aria-hidden="true"/> {phase}</p>}
        {submitting && <SlowRequestFeedback message="This is taking longer than usual. Keep this job open while we check the saved delivery status. Your proof will not be submitted again automatically."/>}
        {error && <div className="flex items-start gap-2 text-sm text-destructive" role="alert"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true"/><span>{error}</span></div>}
        {hasDraft && <Button type="button" variant="ghost" className="min-h-12" disabled={submitting || processingPhoto} onClick={() => void discard()}>Discard saved proof</Button>}
      </form>}
    </CardContent>
  </Card>;
}
