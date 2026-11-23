
const timingStub={withBookingTelemetry:(_,fn)=>fn,timeBooking:(_,fn)=>fn(),recordBookingTiming(){},bookingFailure(){}};
const clientTimingStub={startBookingTiming:()=>({headers:{},response(){},finish(){}})};
const transactionStub={timedDatabase:db=>db,bookingTransaction:(db,fn)=>db.$transaction(fn)};
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function compile(file,imports){imports={"@/lib/booking-telemetry":timingStub,"@/lib/booking-transaction":transactionStub,...imports};const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,Date,URL});return exports;}
const expiry=compile('src/lib/job-expiry.ts',{});
class RiderError extends Error {constructor(message,status){super(message);this.status=status;}}
class RoutingError extends RiderError {constructor(code,message,status=503){super(message,status);this.code=code;}}
function handler(booking,current=booking,{route,providerError,covers=()=>true}={}){const requests=[];let reads=0;const imports={
 'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
 '@/lib/db':{db:{booking:{findUnique:async()=>reads++?current:booking},riderPresence:{findUnique:async()=>({lat:16.02,lng:120.23,locationAt:new Date()})},riderServiceApproval:{findFirst:async()=>({})}}},
 '@/lib/session':{getSession:async()=>({uid:'rider-a'})},
 '@/lib/rider-access':{requireRider:async session=>session,RiderError,riderErrorResponse:error=>Response.json({error:error.message},{status:error.status||500})},
 '@/lib/rider-eligibility':{riderCanTakeBooking:async()=>true,approvalCoversRoute:covers,liveApprovalWhere:()=>({})},
 '@/lib/job-expiry':expiry,
 '@/lib/request-guard':{limitRequests:async()=>{},withRequestLog:(_,fn)=>fn},
 '@/lib/road-routing-service':{roadRoute:async(...args)=>{requests.push(!!args[5]);if(args[5]&&providerError)throw providerError;return route??{source:'openrouteservice',coordinates:[]};}},
 '@/lib/road-routing':{RoutingError},
 };const api=compile('src/app/api/bookings/[id]/route/route.ts',imports);return{run:()=>api.POST({headers:new Headers({Origin:'https://rider.test',Host:'rider.test'})},{params:Promise.resolve({id:'job-a'})}),requests,get providerCalls(){return requests.length;}};}
const booking=(status)=>({status,riderId:'rider-a',type:'RIDE',vehicleClass:'SEDAN',createdAt:new Date(Date.now()-11*60000),scheduledAt:null,pickedUpAt:null,paymentMethod:'CASH',paymentStatus:'UNPAID',customerPaidAt:null,riderReceivedAt:null,pickupLat:16.02,pickupLng:120.23,dropoffLat:16.04,dropoffLng:120.33,excludedRiderIds:[]});
test('expired requests assigned to the current rider cannot consume routing allowance',async()=>{for(const status of ['PENDING','MATCHED']){const h=handler(booking(status));const response=await h.run();assert.equal(response.status,409);assert.match((await response.json()).error,/expired/);assert.equal(h.providerCalls,0);}});
test('finished jobs cannot load new navigation',async()=>{for(const status of ['DELIVERED','CANCELLED']){const h=handler(booking(status));assert.equal((await h.run()).status,409);assert.equal(h.providerCalls,0);}});
test('cancellation or stage changes during a provider call discard obsolete directions',async()=>{for(const status of ['CANCELLED','IN_TRANSIT']){const original=booking('ACCEPTED'),h=handler(original,{...original,status});assert.equal((await h.run()).status,409);assert.equal(h.providerCalls,1);}});

const directPath = [[120.23,16.02],[120.33,16.04]];
const alternatePath = [[120.23,16.02],[120.28,16.06],[120.33,16.04]];

test('only current jobs request alternate directions and tricycle alternatives stay inside the approved area', async () => {
  const route = { coordinates: directPath, alternative: { coordinates: alternatePath } };
  const preview = { ...booking('MATCHED'), createdAt: new Date() };
  const offered = handler(preview, preview, { route });
  assert.equal((await (await offered.run()).json()).alternative, null);
  assert.deepEqual(offered.requests, [false]);

  const active = booking('IN_TRANSIT');
  const car = handler(active, active, { route });
  assert.deepEqual((await (await car.run()).json()).alternative.coordinates, alternatePath);
  assert.deepEqual(car.requests, [true]);

  const tricycle = { ...active, vehicleClass: 'TRICYCLE' };
  const restricted = handler(tricycle, tricycle, { route, covers: (_, point) => point.pickupLat < 16.05 });
  const response = await restricted.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alternative, null);
});

test('main directions remain available if the provider rejects the alternate request', async () => {
  const active = booking('ACCEPTED');
  const route = { coordinates: directPath };
  const h = handler(active, active, { route, providerError: new RoutingError('ROUTE_ALTERNATIVE_UNAVAILABLE', 'unsupported') });
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { route, alternative: null, destination: 'pickup', approximate: true });
  assert.deepEqual(h.requests, [true, false]);
});

test('routing drops duplicate or invalid alternatives while preserving the primary route', () => {
  const { parseRoadRouteWithAlternative } = compile('src/lib/road-routing.ts', {});
  const [start, finish] = directPath.map(([lng, lat]) => ({ lng, lat }));
  const feature = (coordinates, distance = 11000) => ({
    geometry: { type: 'LineString', coordinates },
    properties: { summary: { duration: 1200, distance }, segments: [{ steps: [{ instruction: 'Continue', duration: 1200, distance, way_points: [0, coordinates.length - 1] }] }] },
  });
  const primary = feature(directPath);
  const duplicate = feature(directPath);
  const inaccessible = feature([[120.31,16.03], directPath[1]]);
  const alternative = feature(alternatePath, 12500);
  const parse = (...features) => parseRoadRouteWithAlternative({ features }, start, finish);
  assert.equal(parse(primary, duplicate, inaccessible).alternative, undefined);
  assert.equal(parse(primary, inaccessible, alternative).distanceMeters, 11000);
  assert.equal(parse(primary, inaccessible, alternative).alternative.distanceMeters, 12500);
});
