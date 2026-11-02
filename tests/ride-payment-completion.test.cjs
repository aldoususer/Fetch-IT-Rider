const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={},globals={},source=fs.readFileSync(file,'utf8')){const exports={};vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},Date,Response,AbortController,console,...globals});return exports;}
const policy=load('src/lib/payment-policy.ts');
const base={id:'job',refCode:'LOCAL-PAYMENT',type:'RIDE',riderId:'rider',status:'IN_TRANSIT',paymentMethod:'CASH',paymentStatus:'UNPAID',totalFare:100,customerPaidAt:null,riderReceivedAt:null,customerPaidAmount:null,riderReceivedAmount:null,vehicleClass:'SEDAN',distanceKm:1};
const paid={...base,paymentStatus:'PAID',customerPaidAt:new Date(),riderReceivedAt:new Date(),customerPaidAmount:100,riderReceivedAmount:100};
class DispatchError extends Error{constructor(message,status=409){super(message);this.status=status;}}
function api(record,{uid='rider'}={}){let booking={...record},writes=0,events=0,totals=0,locked=false;
 const tx={$queryRaw:async()=>{locked=true;return[];},booking:{findUnique:async()=>{assert(locked);return booking;},findUniqueOrThrow:async()=>booking,update:async({data})=>{assert(locked);writes++;booking={...booking,...data};return booking;}},riderProfile:{update:async()=>totals++},deliveryProof:{findFirst:async()=>({id:'proof'})}};
 const module=load('src/app/api/bookings/[id]/route.ts',{'@/lib/matching-policy':{},'next/headers':{},'@/lib/demo-payments':{settleDemoEarnings:async()=>{}},'@/lib/payment-policy':policy,'@/lib/dispatch':{DispatchError},'@/lib/request-guard':{withRequestLog:(_,fn)=>fn,RateLimitError:class extends Error{},limitRequests:async()=>{},safeErrorCode:()=>''},'@/lib/db-data':{bookingView:b=>b,riderSelect:{}},'@/lib/booking-events':{recordBookingEvent:async()=>events++},'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/db':{db:{$transaction:fn=>fn(tx)}},'@/lib/rider-access':{getRiderSession:async()=>({uid,role:'RIDER'})},'@/lib/constants':{VEHICLES:{SEDAN:{speedKph:20}}},'@/lib/fare':{etaMinutes:()=>2},'@/lib/ticket':{buildTicketSnapshot:()=>null},'@/lib/job-privacy':{},'@/lib/delivery-challenge':{},'@/lib/payments':{deliveryPaymentError:async()=>null}});
 return{run:(status='DELIVERED')=>module.PATCH({json:async()=>({status})},{params:Promise.resolve({id:'job'})}),get writes(){return writes;},get events(){return events;},get totals(){return totals;},get booking(){return booking;}};
}
test('cash ride cannot complete with missing, one-sided, mismatched or refunded payment',async()=>{
 const cases=[base,{...base,riderReceivedAt:new Date(),riderReceivedAmount:100},{...base,customerPaidAt:new Date(),customerPaidAmount:100},{...paid,paymentStatus:'PENDING'},{...paid,customerPaidAmount:90},{...paid,riderReceivedAmount:90},{...paid,paymentStatus:'REFUNDED'},{...paid,customerPaidAt:null},{...paid,riderReceivedAt:null}];
 for(const booking of cases){const h=api(booking),response=await h.run();assert.equal(response.status,409);assert.match((await response.json()).error,/payment|cash|fare/i);assert.equal(h.writes,0);assert.equal(h.events,0);assert.equal(h.totals,0);assert.equal(h.booking.status,'IN_TRANSIT');}
});
test('both exact cash confirmations allow completion once; retries do not duplicate earnings or events',async()=>{
 const h=api(paid);assert.equal((await h.run()).status,200);assert.equal(h.writes,1);assert.equal(h.events,1);assert.equal(h.totals,1);assert.equal((await h.run()).status,200);assert.equal(h.writes,1);assert.equal(h.events,1);assert.equal(h.totals,1);
});
test('paid online ride can complete; unpaid or refunded online payment cannot',async()=>{
 for(const method of ['DEMO_GCASH','DEMO_MAYA','DEMO_BANK']){assert.equal((await api({...base,paymentMethod:method,paymentStatus:'PAID'}).run()).status,200);for(const paymentStatus of ['UNPAID','PENDING','REFUNDED','FAILED'])assert.equal((await api({...base,paymentMethod:method,paymentStatus}).run()).status,409);}
});
test('payment confirmation does not bypass assignment or trip-stage checks',async()=>{
 assert.equal((await api(paid,{uid:'someone-else'}).run()).status,403);for(const status of ['ACCEPTED','PICKED_UP','CANCELLED'])assert.equal((await api({...paid,status}).run()).status,409);
 assert.equal((await api({...base,status:'PICKED_UP'}).run('IN_TRANSIT')).status,200);
});
function nodes(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
function flow(record=base){const file='src/components/fetchit/rider/rider-dashboard.tsx',source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name.text==='ActiveJobFlow');
 const constants=ast.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['STATUS_STEPS','NEXT_STATUS'].includes(d.name.text))).map(s=>s.getText(ast)).join('\n');
 const slots=[];let index=0,requests=0,resolve;const effects=[];const hooks={useRef(initial){const i=index++;return slots[i]??={current:initial};},useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=v];},useEffect(fn){index++;effects.push(fn);}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};const globals={...hooks,useToast:()=>({toast(){}}),useBookingRecovery:()=>({ready:true,recheck:async()=>{}}),cn:()=>'',statusLabel:s=>s,nextJobStop:()=>({label:'Drop-off',address:'Local test',navigation:'dropoff'}),riderShare:j=>j.totalFare,
 fetch:async()=>{requests++;return new Promise(done=>resolve=()=>done(Response.json({booking:{...paid,status:'DELIVERED'}})));},loadStatsThroughReload:async()=>{}};
 for(const name of ['Button','Card','CardContent','Stat','CheckCircle2','Users','Package','Navigation','Wallet','ChevronDown','PaymentCard','JobRouteMap','ReleaseBooking','PickupProgress','TrackingTicketCard','Phone','Label','KeyRound','Input','ProofCapture','ShieldCheck','Loader2'])globals[name]=name;
 const module=load(file,{'react/jsx-runtime':runtime},globals,constants+'\nexport '+fn.getText(ast));
 const render=()=>{index=0;return module.ActiveJobFlow({job:record,connectionReady:true,onUpdated(){},onClose(){},onDraftChange(){}});};
 return{render,find:(type,label)=>nodes(render()).find(n=>n.type===type&&(!label||text(n).trim()===label)),complete:()=>nodes(render()).find(n=>n.type==='Button'&&text(n).trim()==='Complete ride'),payment:()=>nodes(render()).find(n=>n.type==='PaymentCard'),get requests(){return requests;},finish(){resolve();}};
}
test('Complete ride stays disabled until the payment card verifies readiness; direct clicks also stay blocked',async()=>{
 const h=flow();assert.equal(h.complete().props.disabled,true);await h.complete().props.onClick();assert.equal(h.requests,0);assert(nodes(h.render()).some(n=>n.type==='Button'&&text(n)==='Review payment'));
 h.payment().props.onPaymentReady(true);assert.equal(h.complete().props.disabled,false);const button=h.complete(),first=button.props.onClick(),second=button.props.onClick();assert.equal(h.requests,1);h.finish();await Promise.all([first,second]);
 h.payment().props.onPaymentReady(false);assert.equal(h.complete().props.disabled,true);
});
test('shared payment policy preserves delivery cash walls and validates online readiness',()=>{
 assert.match(policy.deliveryCashCompletionError({...base,type:'DELIVERY'}),/drop-off/);assert.equal(policy.deliveryCashCompletionError({...paid,type:'DELIVERY'}),null);assert(policy.completionPaymentError({...base,paymentMethod:'DEMO_GCASH'}));assert.equal(policy.completionPaymentError({...base,paymentMethod:'DEMO_GCASH',paymentStatus:'PAID'}),null);
});
function card(record,role='RIDER'){
 const slots=[],effects=new Map(),queued=[],reports=[],handlers={};let index=0,reply=()=>Response.json({booking:record}),readOnly=false;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=value];},useRef(initial){const i=index++;return slots[i]??={current:initial};},useEffect(fn,deps){const i=index++,prior=effects.get(i);if(!prior||deps.some((value,n)=>!Object.is(value,prior[n]))){effects.set(i,deps);queued.push(fn);}}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},report=value=>reports.push(value);
 const module=load('src/components/fetchit/shared/payment-card.tsx',{'react':hooks,'react/jsx-runtime':runtime,'@/components/ui/button':{Button:'button'},'@/lib/payment-policy':policy},{document:{hidden:false},navigator:{onLine:true},setInterval:()=>1,clearInterval(){},window:{addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener(){}},fetch:async()=>reply()});
 const render=()=>{index=0;const tree=module.PaymentCard({bookingId:'job',role,readOnly,onPaymentReady:report});while(queued.length)queued.shift()();return tree;};
 return{render,reports,handlers,setReply:fn=>reply=fn,setReadOnly:value=>readOnly=value,async ready(){render();await new Promise(resolve=>setImmediate(resolve));return render();}};
}
test('payment card reports readiness only for matching saved confirmations or paid online checkout',async()=>{
 for(const [record,expected]of [[base,false],[{...paid,customerPaidAt:null},false],[{...paid,riderReceivedAt:null},false],[{...paid,riderReceivedAmount:99},false],[paid,true],[{...base,paymentMethod:'DEMO_GCASH'},false],[{...base,paymentMethod:'DEMO_GCASH',paymentStatus:'PAID'},true],[{...paid,type:'DELIVERY',dropoffReachedAt:null},false]]){
  const h=card(record);await h.ready();assert.equal(h.reports.at(-1),expected,JSON.stringify(record));
 }
});
test('a failed payment refresh blocks completion until a successful recheck; read-only mode never enables it',async()=>{
 const h=card(paid);await h.ready();assert.equal(h.reports.at(-1),true);h.setReply(()=>Promise.reject(Error('Network unavailable')));await h.handlers.focus();h.render();assert.equal(h.reports.at(-1),false);
 h.setReply(()=>Response.json({booking:paid}));await h.handlers.focus();h.render();assert.equal(h.reports.at(-1),true);h.setReadOnly(true);h.render();assert.equal(h.reports.at(-1),false);
});
test('ride feedback identifies the missing participant for customer and rider',async()=>{
 const waitingCustomer={...paid,customerPaidAt:null,paymentStatus:'PENDING'};
 const rider=card(waitingCustomer);assert.match(text(await rider.ready()),/Waiting for the customer/);
 const customer=card(waitingCustomer,'CUSTOMER');assert.match(text(await customer.ready()),/Confirm cash paid after handing/);
 const waitingRider=card({...paid,riderReceivedAt:null},'CUSTOMER');assert.match(text(await waitingRider.ready()),/Waiting for the rider/);
});
test('a failed payment recheck keeps entered delivery proof mounted while blocking submission',()=>{
 const h=flow({...base,type:'DELIVERY'});h.payment().props.onPaymentReady(true);h.find('Button','Capture signature & photo').props.onClick();assert(h.find('ProofCapture'));
 h.find('ProofCapture').props.onProofState({busy:false,preparing:false,hasSignature:true,hasPhoto:true});assert.equal(h.find('Button','Complete delivery').props.disabled,false);
 h.payment().props.onPaymentReady(false);assert(h.find('ProofCapture'));assert.equal(h.find('ProofCapture').props.disabled,true);assert.equal(h.find('Button','Complete delivery').props.disabled,true);
});
