const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/load-local-demo.cjs');
const { DocumentUploadQueue, sendDocumentUpload } = loader()('src/lib/document-upload-client.ts');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };

test('two independent slots run together, a third queues, and a failed slot retries without blocking its neighbors', async()=>{
  const runs=[],pending=[],states=[];
  const queue=new DocumentUploadQueue(async(kind,file,retry,signal,progress)=>{ const d=deferred();runs.push({kind,file,retry,signal,progress});pending.push(d);await d.promise; },state=>states.push(state));
  const file=name=>new File(['fixture'],name);
  queue.enqueue('PROFILE',file('portrait.png'));queue.enqueue('NBI',file('clearance.pdf'));queue.enqueue('OR',file('receipt.jpg'));
  assert.equal(queue.enqueue('PROFILE',file('duplicate.png')),false);
  await tick();assert.equal(runs.length,2);assert.equal(states.at(-1).OR.phase,'queued');
  runs[0].progress({phase:'sending',percent:37});assert.equal(states.at(-1).PROFILE.percent,37);assert.equal(states.at(-1).NBI.phase,'preparing');
  pending[0].reject(new Error('Network interrupted'));await tick();assert.equal(runs.length,3);assert.equal(states.at(-1).PROFILE.phase,'error');assert.equal(queue.hasPending(),true);
  pending[1].resolve();pending[2].resolve();await tick();assert.equal(queue.hasPending(),false);assert.equal(states.at(-1).NBI.phase,'done');
  queue.retry('PROFILE');await tick();assert.equal(runs.at(-1).retry,true);assert.equal(runs.at(-1).file.name,'portrait.png');
  pending[3].resolve();await tick();assert.equal(states.at(-1).PROFILE.phase,'done');queue.dispose();
});

test('unmount aborts requests and prevents late progress from updating the page', async()=>{
  let signal,progress,notifications=0;const d=deferred();
  const queue=new DocumentUploadQueue(async(_k,_f,_r,s,p)=>{signal=s;progress=p;await d.promise;},()=>notifications++);
  queue.enqueue('PROFILE',new File(['fixture'],'photo.jpg'));await tick();queue.dispose();const before=notifications;
  assert.equal(signal.aborted,true);progress({phase:'saving',percent:100});d.resolve();await tick();assert.equal(notifications,before);
});

class FakeXHR {
  static latest;
  constructor(){this.upload={};FakeXHR.latest=this;}
  open(method,url){this.method=method;this.url=url;}
  send(form){this.form=form;}
  abort(){this.onabort();}
}
test('progress is measured from transmitted bytes, while server processing waits for the saved response',async()=>{
  const previous=global.XMLHttpRequest;global.XMLHttpRequest=FakeXHR;
  try{
    const progress=[],form=new FormData(),controller=new AbortController();let complete=false;
    const result=sendDocumentUpload(form,controller.signal,value=>progress.push(value)).then(value=>{complete=true;return value;});
    const xhr=FakeXHR.latest;xhr.upload.onprogress({lengthComputable:true,loaded:25,total:100});assert.deepEqual(progress.at(-1),{phase:'sending',percent:25});
    xhr.upload.onload();await tick();assert.equal(complete,false);assert.deepEqual(progress.at(-1),{phase:'saving',percent:100});
    xhr.status=200;xhr.responseText=JSON.stringify({application:{version:4}});await xhr.onload();assert.equal((await result).application.version,4);
    assert.equal(xhr.method,'POST');assert.equal(xhr.url,'/api/rider/application');
  }finally{global.XMLHttpRequest=previous;}
});
test('gateway failures stay readable and aborted requests reject instead of reporting success',async()=>{
  const previous=global.XMLHttpRequest;global.XMLHttpRequest=FakeXHR;
  try{
    const promise=sendDocumentUpload(new FormData(),new AbortController().signal,()=>{});const xhr=FakeXHR.latest;
    const rejected=assert.rejects(promise,/timed out/i);xhr.status=504;xhr.responseText='An error occurred';await xhr.onload();await rejected;
    const controller=new AbortController(),aborted=sendDocumentUpload(new FormData(),controller.signal,()=>{});const checked=assert.rejects(aborted,/canceled/);controller.abort();await checked;
  }finally{global.XMLHttpRequest=previous;}
});
