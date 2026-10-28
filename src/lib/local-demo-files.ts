import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localDemoEnabled } from './local-demo-runtime';
export function localDemoDirectory() {
  const root = path.resolve(process.env.LOCAL_DEMO_DIRECTORY || '.');
  if (!localDemoEnabled() || path.basename(root) !== process.env.LOCAL_DEMO_SCHEMA || path.basename(path.dirname(root)) !== 'local-rider-lab') throw new Error('Local demo storage unavailable.');
  return root;
}
function documentFile(pathname: string) {
  if (!/^rider-applications\/[a-zA-Z0-9_-]{1,160}\/[a-f0-9-]{36}\.(jpg|pdf)$/.test(pathname)) throw new Error('Invalid local document path.');
  return path.join(localDemoDirectory(), 'documents', ...pathname.split('/'));
}
export async function writeLocalDocument(pathname: string, bytes: Buffer) {
  const file = documentFile(pathname); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
}
export async function readLocalDocument(pathname: string) { return fs.readFile(documentFile(pathname)); }
export async function removeLocalDocument(pathname: string) { await fs.unlink(documentFile(pathname)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
type LocalMail = { id: string; to: string; subject: string; text: string; createdAt: string; attachments: string[] };
export async function captureLocalMail(message: { to?: unknown; subject?: unknown; text?: unknown; attachments?: unknown }) {
  if (typeof message.to !== 'string' || !/^[a-zA-Z0-9._+-]+@(?:rider-demo|fetch-demo)\.example\.invalid$/.test(message.to)) throw new Error('Local lab mail accepts fictional demo recipients only.');
  const id = randomUUID(), dir = path.join(localDemoDirectory(), 'mail'); await fs.mkdir(dir, { recursive: true });
  const attachments: string[] = [];
  for (const [index, item] of (Array.isArray(message.attachments) ? message.attachments : []).entries()) {
    if (item && Buffer.isBuffer(item.content)) { const name = `${id}-${index}.pdf`; await fs.writeFile(path.join(dir, name), item.content, { flag: 'wx', mode: 0o600 }); attachments.push(name); }
  }
  const mail: LocalMail = { id, to: message.to, subject: String(message.subject || ''), text: String(message.text || ''), createdAt: new Date().toISOString(), attachments };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(mail), { flag: 'wx', mode: 0o600 });
  return { accepted: [message.to] };
}
export async function localMailbox(email: string): Promise<LocalMail[]> {
  const dir = path.join(localDemoDirectory(), 'mail');
  const names = await fs.readdir(dir).catch(() => [] as string[]), mails: LocalMail[] = [];
  for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const mail = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as LocalMail;
    if (mail.to === email) mails.push(mail);
  }
  return mails.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
}
