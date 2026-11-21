const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,URL,require:n=>{assert(n in deps,'Unexpected dependency '+n);return deps[n];}});return exports;}
const dates=load('src/lib/rider-history-date.ts');
test('chosen Philippine booking day uses inclusive local midnight and exclusive following midnight',()=>{const range=dates.riderHistoryDateRange('2026-11-18');assert.equal(range.gte.toISOString(),'2026-11-17T16:00:00.000Z');assert.equal(range.lt.toISOString(),'2026-11-18T16:00:00.000Z');for(const [date,next] of [['2028-02-29','2028-03-01'],['2026-12-31','2027-01-01']])assert.equal(dates.riderHistoryDateRange(date).lt.toISOString(),new Date(next+'T00:00:00+08:00').toISOString());for(const invalid of ['2026-02-29','2026-02-30','2026-13-01','11/18/2026','2026-11-18T00:00:00Z',''])assert.equal(dates.riderHistoryDateRange(invalid),null,invalid);});
function api(session={uid:'rider-1',role:'RIDER'}){const queries=[];let expiry=0;const route=load('src/app/api/bookings/route.ts',{'@/lib/matching-policy':{dispatchSelect:{}},'@/lib/dispatch':{expireRiderOffers:async()=>expiry++},'@/lib/db-data':{bookingView:b=>b,riderSelect:{}},'next/server':{NextResponse:{json:Response.json}},'@/lib/db':{db:{booking:{findMany:async q=>{queries.push(q);return[{id:'older-booking'}];}}}},'@/lib/rider-access':{getRiderSession:async()=>session},'@/lib/ticket':{buildTicketSnapshot:()=>null,encodeTicket:()=>null},'@/lib/job-privacy':{riderJobView:b=>b},'@/lib/rider-history-date':dates});return{queries,get expiry(){return expiry;},get:path=>route.GET({url:'https://rider.test/api/bookings'+path})};}
test('date filters in the database before the 100-booking limit and stays scoped to the signed-in rider',async()=>{const h=api(),response=await h.get('?filter=history&date=2026-11-18');assert.equal(response.status,200);const q=h.queries[0];assert.equal(q.where.riderId,'rider-1');assert.equal(q.where.createdAt.gte.toISOString(),'2026-11-17T16:00:00.000Z');assert.equal(q.where.createdAt.lt.toISOString(),'2026-11-18T16:00:00.000Z');assert.equal(q.where.status.in.join(','),'DELIVERED,CANCELLED');assert.equal(q.take,100);assert.equal((await response.json()).bookings[0].id,'older-booking');});
test('invalid dates cause no database work; clearing date and active jobs keep existing queries',async()=>{const bad=api();assert.equal((await bad.get('?filter=history&date=2026-02-30')).status,400);assert.equal(bad.queries.length,0);assert.equal(bad.expiry,0);for(const query of ['?filter=history','?filter=history&date=','?filter=active&date=bad']){const h=api();assert.equal((await h.get(query)).status,200);assert.equal(h.queries[0].where.createdAt,undefined);}const denied=api(null);assert.equal((await denied.get('?filter=history&date=2026-11-18')).status,401);assert.equal(denied.queries.length,0);});
const jsx=(type,props)=>({type,props});function nodes(n){return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}function text(n){return typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):text(n?.props?.children||'');}
function filtersPanel(filters={status:'DELIVERED',date:'2026-11-18',basis:'created'}){
 const slots=[],applied=[];let index=0;
 const dialogs=Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogHeader','DialogTitle','DialogTrigger'].map(name=>[name,name]));
 const ui=load('src/components/fetchit/rider/history-filters.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},react:{useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value;}];},useRef(initial){return slots[index++]??={current:initial};}},'lucide-react':{Search:'search-icon',SlidersHorizontal:'filter-icon'},'@/components/ui/button':{Button:'button'},'@/components/ui/dialog':dialogs});
 const render=()=>{index=0;return ui.HistoryFilters({query:'Lingayen',filters,onApply:value=>applied.push({...value})});};
 const find=predicate=>nodes(render()).find(predicate);
 function open(value){
  find(n=>n.type==='Dialog').props.onOpenChange(value);
  const date=find(n=>n.props?.type==='date').props;
  date.ref.current=value?{value:date.defaultValue}:null;
 }
 return {render,find,applied,open,submit(){find(n=>n.type==='form').props.onSubmit({preventDefault(){}});}};
}
test('history filters open on demand, apply together and discard changes when closed',()=>{
 const h=filtersPanel(),date=()=>h.find(n=>n.props?.type==='date');
 assert.equal(h.find(n=>n.type==='Dialog').props.open,false);
 h.open(true);
 assert.equal(date().props.ref.current.value,'2026-11-18');
 date().props.ref.current.value='2026-11-17';
 assert.equal(h.applied.length,0);
 h.open(false);h.open(true);
 assert.equal(date().props.ref.current.value,'2026-11-18');
 date().props.ref.current.value='2026-11-17';
 assert.match(text(h.render()),/Filters · 2/);
 h.submit();
 assert.deepEqual(h.applied,[{date:'2026-11-17',status:'DELIVERED',basis:'created'}]);
 assert.equal(h.find(n=>n.props?.type==='search').props.value,'Lingayen');
 h.open(true);h.find(n=>n.type==='button'&&text(n)==='Reset').props.onClick();h.submit();
 assert.deepEqual(h.applied.at(-1),{date:'',status:'ALL',basis:'created'});
});

test('finished-date filtering uses completion/cancellation timestamps without widening rider access',async()=>{
 const h=api(),r=await h.get('?filter=history&date=2026-11-21&dateBasis=finished');assert.equal(r.status,200);
 const q=h.queries[0];assert.equal(q.where.riderId,'rider-1');assert.equal(q.where.createdAt,undefined);assert.equal(q.take,100);
 assert.equal(q.where.OR[0].status,'DELIVERED');assert.equal(q.where.OR[0].deliveredAt.gte.toISOString(),'2026-11-20T16:00:00.000Z');
 assert.equal(q.where.OR[1].status,'CANCELLED');assert.equal(q.where.OR[1].cancelledAt.lt.toISOString(),'2026-11-21T16:00:00.000Z');
 const bad=api();assert.equal((await bad.get('?filter=history&date=2026-11-21&dateBasis=unknown')).status,400);assert.equal(bad.queries.length,0);
});
test('date basis is an explicit choice and never relabels a created-date filter as completion',()=>{
 const h=filtersPanel({status:'ALL',date:'2026-11-21',basis:'finished'});
 h.open(true);
 assert.match(text(h.render()),/Completed\/cancelled date/);
 assert.match(text(h.render()),/recorded completion or cancellation date/);
 h.find(n=>n.type==='select'&&n.props.value==='finished').props.onChange({target:{value:'created'}});
 assert.match(text(h.render()),/Booking date/);
 assert.match(text(h.render()),/Finished/);
 h.submit();assert.equal(h.applied[0].basis,'created');
});
