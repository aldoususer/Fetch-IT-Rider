const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},Date,AbortSignal,Promise,setTimeout,clearTimeout,console,...globals});return exports;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('an existing alert drains while an unrelated offer worker is still waiting',async()=>{
 let after,release,drains=0;const priority=[];
 const api=load('src/lib/push-delivery.ts',{'next/server':{after:fn=>after=fn},'web-push':{default:{}},'./db':{db:{$queryRaw:async()=>[]}},'./push-input':{validPushEndpoint:()=>true},'./rider-push-tasks':{drainRiderPushTasks:async(_,id)=>{drains++;priority.push(id);return 0;}},'./automatching':{matchingRecoveryIds:async()=>[{bookingId:'waiting-offer'}],runAutomaticMatching:async()=>new Promise(resolve=>release=resolve)}});
 api.schedulePushDelivery();const work=after();await flush();assert.equal(drains,1);assert.equal(priority[0],undefined);release();await work;
});
test('new-offer delivery stays scoped to the booking that triggered it',async()=>{
 let after;const priority=[];
 const api=load('src/lib/push-delivery.ts',{'next/server':{after:fn=>after=fn},'web-push':{default:{}},'./db':{db:{$queryRaw:async()=>[]}},'./push-input':{validPushEndpoint:()=>true},'./rider-push-tasks':{drainRiderPushTasks:async(_,id)=>{priority.push(id);return 0;}},'./automatching':{matchingRecoveryIds:async()=>{throw Error('No global recovery needed');},runAutomaticMatching:async(_,id,deliver)=>{assert.equal(id,'new-booking');await deliver();}}});
 api.schedulePushDelivery('new-booking');await after();assert.equal(priority.length,2);assert(priority.every(id=>id==='new-booking'));
});
function routingHarness(fetcher){let reads=0;const writes=[],budgets=[];const tx={$queryRaw:async(strings)=>{reads++;return strings.join('').includes('COUNT(*)')?[{minute:0,day:0}]:[];},$executeRaw:async(strings,...values)=>{writes.push({sql:strings.join('?'),values});return 1;}};
 const db={...tx,$transaction:async(fn,options)=>{budgets.push(options);return fn(tx);}};
 const roads=load('src/lib/road-routing.ts');const api=load('src/lib/road-routing-service.ts',{'node:crypto':require('node:crypto'),'./db':{db},'./service-area':{bookingServiceAreaError:()=>null},'./road-routing':roads},{process:{env:{OPENROUTESERVICE_API_KEY:'local-test-key'}},fetch:fetcher});
 return{api,writes,budgets,get reads(){return reads;}};
}
test('an expired matching ETA budget cannot start a database or provider request',async()=>{
 const h=routingHarness(()=>{throw Error('Provider must not run');});await assert.rejects(h.api.roadRoute({lat:16,lng:120},{lat:16.01,lng:120},'SEDAN',{deadlineAt:Date.now()-1}),e=>e.code==='ROUTE_DEADLINE');assert.equal(h.reads,0);
});
test('slow pickup routing is aborted at the short matching deadline without a minute cooldown',async()=>{
 let signal;const h=routingHarness(async(_,options)=>{signal=options.signal;return new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});});
 const start=Date.now(),pending=h.api.roadRoute({lat:16,lng:120},{lat:16.01,lng:120},'SEDAN',{deadlineAt:start+150});
 // Keep node:test alive while AbortSignal's unref'ed timer is pending.
 const keepAlive=setTimeout(()=>{},2000);try{await assert.rejects(pending,e=>e.code==='ROUTE_DEADLINE');}finally{clearTimeout(keepAlive);}
 assert(signal.aborted);assert(Date.now()-start<1500);assert(h.budgets[0].timeout<=150);
 const cleanup=h.writes.findLast(row=>row.sql.includes('SET "result" = NULL'));assert(cleanup);assert(cleanup.values[0].getTime()<=Date.now()+50);assert(!h.writes.some(row=>row.sql.startsWith('DELETE')));
});
test('ordinary directions retain their normal provider budget and outage cooldown',async()=>{
 let signal;const h=routingHarness(async(_,options)=>{signal=options.signal;throw Error('provider outage');});
 await assert.rejects(h.api.roadRoute({lat:16,lng:120},{lat:16.01,lng:120},'SEDAN'),e=>e.code==='ROUTE_PROVIDER');
 assert(!signal.aborted);assert.equal(h.budgets[0].timeout,10000);assert(h.writes.some(row=>row.sql.startsWith('DELETE')));
 const cleanup=h.writes.findLast(row=>row.sql.includes('SET "result" = NULL'));assert(cleanup.values[0].getTime()>Date.now()+59000);
});
