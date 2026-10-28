import { readApplicationJson } from './application-client-response';

export type UploadProgress = { phase: 'sending' | 'saving'; percent: number };
export function sendDocumentUpload(form: FormData, signal: AbortSignal, progress: (value: UploadProgress) => void): Promise<{ application: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.open('POST', '/api/rider/application');
    xhr.timeout = 90000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress({ phase: 'sending', percent: Math.round(event.loaded / event.total * 100) }); };
    xhr.upload.onload = () => progress({ phase: 'saving', percent: 100 });
    xhr.onerror = () => { finish(); reject(new Error('The connection was interrupted. Retry this file when you are online.')); };
    xhr.ontimeout = () => { finish(); reject(new Error('This upload timed out. Retry to refresh saved progress first.')); };
    xhr.onabort = () => { finish(); reject(new Error('Upload canceled.')); };
    xhr.onload = async () => {
      finish();
      try {
        const data = await readApplicationJson(new Response(xhr.responseText, { status: xhr.status }));
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || 'This file could not be uploaded.');
        if (!data.application) throw new Error('The upload response was incomplete. Retry to check saved progress.');
        resolve(data);
      } catch (error) { reject(error); }
    };
    if (signal.aborted) { reject(new Error('Upload canceled.')); return; }
    signal.addEventListener('abort', abort, { once: true });
    progress({ phase: 'sending', percent: 0 });
    xhr.send(form);
  });
}

export type UploadState = { name: string; phase: 'queued' | 'preparing' | 'sending' | 'saving' | 'done' | 'error'; percent: number; error?: string };
type Job = { file?: File; state: UploadState; controller: AbortController; retry: boolean };
export const uploadPending = (state?: UploadState) => !!state && !['done', 'error'].includes(state.phase);

// Bound network concurrency; choosing a file in another slot always stays available.
export class DocumentUploadQueue {
  private jobs = new Map<string, Job>();
  private active = 0;
  private disposed = false;
  constructor(private run: (kind: string, file: File, retry: boolean, signal: AbortSignal, progress: (value: UploadProgress) => void) => Promise<void>, private notify: (states: Record<string, UploadState>) => void, private concurrency = 2) {}
  enqueue(kind: string, file: File, retry = false) {
    if (this.disposed || uploadPending(this.jobs.get(kind)?.state)) return false;
    this.jobs.set(kind, { file, retry, controller: new AbortController(), state: { name: file.name, phase: 'queued', percent: 0 } });
    this.emit(); this.pump(); return true;
  }
  retry(kind: string) { const job = this.jobs.get(kind); if (job?.state.phase === 'error' && job.file) this.enqueue(kind, job.file, true); }
  hasPending() { return [...this.jobs.values()].some(job => uploadPending(job.state)); }
  resume() { this.disposed = false; this.pump(); }
  dispose() { this.disposed = true; for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); }
  private emit() { if (!this.disposed) this.notify(Object.fromEntries([...this.jobs].map(([kind, job]) => [kind, { ...job.state }]))); }
  private pump() {
    if (this.disposed) return;
    for (const [kind, job] of this.jobs) {
      if (this.active >= this.concurrency) break;
      if (job.state.phase !== 'queued' || !job.file) continue;
      this.active++; job.state.phase = 'preparing'; this.emit();
      const file = job.file;
      void Promise.resolve().then(() => this.run(kind, file, job.retry, job.controller.signal, value => {
        if (job.state.phase === value.phase && job.state.percent === value.percent) return;
        job.state = { name: job.state.name, ...value }; this.emit();
      })).then(() => { job.state = { name: job.state.name, phase: 'done', percent: 100 }; job.file = undefined; })
        .catch(error => { job.state = { ...job.state, phase: 'error', error: error instanceof Error ? error.message : 'This file could not be uploaded.' }; })
        .finally(() => { this.active--; this.emit(); this.pump(); });
    }
  }
}
