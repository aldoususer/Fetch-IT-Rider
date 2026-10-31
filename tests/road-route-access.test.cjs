const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function compile(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,Date,URL});return exports;}
const expiry=compile('src/lib/job-expiry.ts',{});
class RiderError extends Error {constructor(message,status){super(message);this.status=status;}}
class RoutingError extends RiderError {}
function handler(booking,current=booking){let providerCalls=0,reads=0;const imports={
 'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
 '@/lib/db':{db:{booking:{findUnique:async()=>reads++?current:booking},riderPresence:{findUnique:async()=>({lat:16.02,lng:120.23,locationAt:new Date()})}}},
 '@/lib/session':{getSession:async()=>({uid:'rider-a'})},
 '@/lib/rider-access':{requireRider:async session=>session,RiderError,riderErrorResponse:error=>Response.json({error:error.message},{status:error.status||500})},
 '@/lib/rider-eligibility':{riderCanTakeBooking:async()=>true,approvalCoversRoute:()=>true,liveApprovalWhere:()=>({})},
 '@/lib/job-expiry':expiry,
 '@/lib/request-guard':{limitRequests:async()=>{},withRequestLog:(_,fn)=>fn},
 '@/lib/road-routing-service':{roadRoute:async()=>{providerCalls++;return{source:'openrouteservice',coordinates:[]};}},
 '@/lib/road-routing':{RoutingError},
 };const api=compile('src/app/api/bookings/[id]/route/route.ts',imports);return{run:()=>api.POST({headers:new Headers({Origin:'https://rider.test',Host:'rider.test'})},{params:Promise.resolve({id:'job-a'})}),get providerCalls(){return providerCalls;}};}
const booking=(status)=>({status,riderId:'rider-a',type:'RIDE',vehicleClass:'SEDAN',createdAt:new Date(Date.now()-11*60000),scheduledAt:null,pickedUpAt:null,paymentMethod:'CASH',paymentStatus:'UNPAID',customerPaidAt:null,riderReceivedAt:null,pickupLat:16.02,pickupLng:120.23,dropoffLat:16.04,dropoffLng:120.33,excludedRiderIds:[]});
test('expired requests assigned to the current rider cannot consume routing allowance',async()=>{for(const status of ['PENDING','MATCHED']){const h=handler(booking(status));const response=await h.run();assert.equal(response.status,409);assert.match((await response.json()).error,/expired/);assert.equal(h.providerCalls,0);}});
test('finished jobs cannot load new navigation',async()=>{for(const status of ['DELIVERED','CANCELLED']){const h=handler(booking(status));assert.equal((await h.run()).status,409);assert.equal(h.providerCalls,0);}});
test('cancellation or stage changes during a provider call discard obsolete directions',async()=>{for(const status of ['CANCELLED','IN_TRANSIT']){const original=booking('ACCEPTED'),h=handler(original,{...original,status});assert.equal((await h.run()).status,409);assert.equal(h.providerCalls,1);}});
