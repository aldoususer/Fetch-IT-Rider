const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const now = new Date('2026-10-29T06:10:00Z');
function load(file, deps, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,require(name){if(!(name in deps)) throw Error('Unexpected import '+name);return deps[name];},URL,Date,...globals});
  return exports;
}
const eligibility = load('src/lib/rider-eligibility.ts',{});
const views = load('src/lib/db-data.ts',{});
const privacy = load('src/lib/job-privacy.ts',{});
function matches(row, where) {
  return Object.entries(where).every(([key,value])=>{
    if(key==='AND') return value.every(v=>matches(row,v));
    if(key==='OR') return value.some(v=>matches(row,v));
    if(key==='NOT') return !matches(row,value);
    if(value && typeof value==='object' && !(value instanceof Date)) return Object.entries(value).every(([op,v])=>op==='in'?v.includes(row[key]):op==='lte'?row[key]!==null&&row[key]<=v:op==='gt'?row[key]!==null&&row[key]>v:op==='has'?row[key].includes(v):false);
    return row[key]===value;
  });
}
const zone = [[120.18,15.95],[120.40,15.95],[120.40,16.10],[120.18,16.10],[120.18,15.95]];
function booking(id, scheduledAt=null, extra={}) {return {id,refCode:id,status:'PENDING',riderId:null,vehicleClass:'TRICYCLE',type:'DELIVERY',paymentMethod:'CASH',paymentStatus:'UNPAID',excludedRiderIds:[],pickupLat:16.02,pickupLng:120.23,dropoffLat:16.03,dropoffLng:120.27,customerId:'private-customer',customer:{name:'Private name',phone:'private-number'},scheduledAt:scheduledAt?new Date(scheduledAt):null,...extra};}
function harness({online=true,services=['DELIVERY','RIDE'],rows=[],authorized=true,banned=false,clock=now}={}) {
  const queries=[];let writes=0;
  const approvals=services.map(service=>({service,source:'OWNER_PERSONA',operatingZone:zone}));
  const db={user:{findUnique:async()=>({isBanned:banned,riderProfile:{vehicleClass:'TRICYCLE'},riderPresence:{isOnline:online}})},riderPresence:{updateMany:async()=>{writes++;}},riderServiceApproval:{findMany:async()=>approvals},booking:{findMany:async query=>{queries.push(query);return rows.filter(row=>matches(row,query.where));}}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}}
  const route=load('src/app/api/rider/available/route.ts',{
    '@/lib/rider-eligibility':eligibility,'@/lib/dispatch':{expireRiderOffers:async()=>{},dispatchPaymentWhere:{OR:[{paymentMethod:'CASH'},{paymentMethod:{in:['DEMO_GCASH','DEMO_MAYA','DEMO_BANK']},paymentStatus:'PAID'}]}},
    '@/lib/db-data':views,'next/server':{NextResponse:{json:(data,init={})=>({data,status:init.status??200,headers:init.headers})}},'@/lib/db':{db},'@/lib/rider-access':{getRiderSession:async()=>authorized?{uid:'persona',role:'RIDER'}:null},'@/lib/job-privacy':privacy,
  },{Date:Clock});
  return {run:()=>route.GET({url:'https://rider.test/api/rider/available?includeMatched=true'}),queries,get writes(){return writes;}};
}
test('scheduled delivery and ride appear separately, while due jobs remain claimable',async()=>{
  const h=harness({rows:[booking('now'),booking('today','2026-10-29T06:21:00Z'),booking('tomorrow','2026-10-29T21:00:00Z',{type:'RIDE'}),booking('assigned','2026-10-29T21:00:00Z',{riderId:'other',status:'MATCHED'}),booking('wrong-car',null,{vehicleClass:'SEDAN'}),booking('excluded',null,{excludedRiderIds:['persona']}),booking('unpaid-online','2026-10-29T21:00:00Z',{paymentMethod:'DEMO_GCASH',paymentStatus:'PENDING'})]});
  const response=await h.run();assert.equal(response.status,200);
  assert.deepEqual(Array.from(response.data.jobs,j=>j.id),['now']);
  assert.deepEqual(Array.from(response.data.upcomingJobs,j=>j.id),['today','tomorrow']);
  assert.equal(response.headers['Cache-Control'],'private, no-store');
  for(const j of [...response.data.jobs,...response.data.upcomingJobs]) {assert.equal(j.customerId,undefined);assert.equal(j.customer.phone,null);assert.equal(j.customer.name,'Customer');}
});
test('future requests still enforce service approvals and tricycle route boundary',async()=>{
  const h=harness({services:['DELIVERY'],rows:[booking('delivery','2026-10-29T21:00:00Z'),booking('ride','2026-10-29T21:00:00Z',{type:'RIDE'})]});
  assert.deepEqual(Array.from((await h.run()).data.upcomingJobs,j=>j.id),['delivery']);
  const zoned=harness({rows:[booking('outside','2026-10-29T21:00:00Z',{type:'RIDE',dropoffLng:121}),booking('inside','2026-10-29T21:00:00Z',{type:'RIDE'})]});
  assert.deepEqual(Array.from((await zoned.run()).data.upcomingJobs,j=>j.id),['inside']);
});
test('a scheduled booking moves to available exactly at pickup time without duplicate listing',async()=>{
  const h=harness({clock:new Date('2026-10-29T06:21:00Z'),rows:[booking('today','2026-10-29T06:21:00Z')]});
  const {data}=await h.run();assert.deepEqual(Array.from(data.jobs,j=>j.id),['today']);assert.equal(data.upcomingJobs.length,0);
});
test('offline personas receive empty lists and no presence write or booking query',async()=>{
  const h=harness({online:false,rows:[booking('future','2026-10-29T21:00:00Z')]});const {data}=await h.run();assert.equal(data.jobs.length,0);assert.equal(data.upcomingJobs.length,0);assert.equal(h.queries.length,0);assert.equal(h.writes,0);
});
test('guest and banned accounts cannot read either list',async()=>{
  assert.equal((await harness({authorized:false}).run()).status,401);assert.equal((await harness({banned:true}).run()).status,403);
});
