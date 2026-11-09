// Run in a disposable localhost browser context only. Uses the real IndexedDB engine.
import { readProofDraft, saveProofDraft, removeProofDraft, retainActiveProofDrafts, setProofDraftOwner, PROOF_DRAFT_TTL } from '../src/lib/proof-drafts';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9XkAAAAASUVORK5CYII=';
const draft = () => ({ownerId:'ux-rider',bookingId:'ux-local',savedAt:Date.now(),signatureSvg:'<path d="M 20 40 L 70 60 L 150 25 L 230 60" />',photoDataUrl:photo,photoName:'local-proof.png',recipientName:'QA recipient',attemptKey:'test-attempt'});
export async function checkProofDraftStorage(){
  const result:string[]=[];const ok=(condition:boolean,label:string)=>{if(!condition)throw Error(label);result.push('PASS · '+label);};
  try {
   setProofDraftOwner(null);setProofDraftOwner('ux-rider');
   ok(await saveProofDraft(draft()),'Draft writes to IndexedDB');
   const restored=await readProofDraft('ux-rider','ux-local');ok(restored?.recipientName==='QA recipient'&&restored.attemptKey==='test-attempt','Signature/photo/name/request key read back');
   const write=saveProofDraft(draft());const discard=removeProofDraft('ux-rider','ux-local');await Promise.all([write,discard]);ok(await readProofDraft('ux-rider','ux-local')===null,'Discard defeats queued stale autosave');
   await saveProofDraft(draft());setProofDraftOwner('different-rider');ok(await readProofDraft('ux-rider','ux-local')===null,'Account switch cannot read another rider’s proof');
   setProofDraftOwner('ux-rider');ok(await readProofDraft('ux-rider','ux-local')===null,'Previous account proof removed from shared device');
   await saveProofDraft(draft());await retainActiveProofDrafts('ux-rider',[]);ok(await readProofDraft('ux-rider','ux-local')===null,'Completed or removed jobs lose their draft');ok(!await saveProofDraft(draft()),'Late autosave cannot resurrect a completed job');
   await retainActiveProofDrafts('ux-rider',[{id:'ux-local',riderId:'ux-rider',status:'IN_TRANSIT'}]);await saveProofDraft(draft());await retainActiveProofDrafts('ux-rider',[{id:'ux-local',riderId:'other',status:'IN_TRANSIT'}]);ok(await readProofDraft('ux-rider','ux-local')===null,'Reassignment clears the old rider’s draft');
   setProofDraftOwner(null);setProofDraftOwner('ux-rider');const pending=saveProofDraft(draft());setProofDraftOwner(null);await pending;setProofDraftOwner('ux-rider');ok(await readProofDraft('ux-rider','ux-local')===null,'Logout prevents an in-flight write returning');
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('fetchit-rider-proof-drafts',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({...draft(),savedAt:Date.now()-PROOF_DRAFT_TTL-1},JSON.stringify(['ux-rider','ux-local']));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});
   ok(await readProofDraft('ux-rider','ux-local')===null,'Expired sensitive proof is removed');
   await saveProofDraft(draft());result.push('ALL 10 STORAGE CHECKS PASSED');
  }catch(failure){result.push('FAIL · '+String(failure));}return result;
 }
