"use client";
import type { UploadState } from '@/lib/document-upload-client';

export function DocumentUploadStatus({ state, label, retry }: { state?: UploadState; label: string; retry: () => void }) {
  if (!state || state.phase === 'done') return null;
  const text = state.phase === 'queued' ? 'Waiting for an upload slot…' : state.phase === 'preparing' ? 'Preparing upload…' : state.phase === 'saving' ? '100% sent · checking and saving…' : `${state.percent}% sent`;
  return <div className={`ra-upload-state ${state.phase === 'error' ? 'is-error' : ''}`} aria-busy={state.phase !== 'error'}>
    <strong className="ra-upload-name">{state.name}</strong>
    {state.phase === 'error' ? <><p role="alert">{state.error}</p><button type="button" onClick={retry}>Retry {label.toLowerCase()}</button></> : <>
      <progress max={100} value={state.phase === 'sending' ? state.percent : undefined} aria-label={`${label}: ${text}`}/>
      <span role="status">{text}</span>
    </>}
  </div>;
}
