const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function load(file,deps={},globals={}){const exports={};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,Date,Number,Error,URL,AbortController,require(name){if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);},...globals});return exports;}
const ui=load('src/lib/rider-workspace.ts'),policy=load('src/lib/payment-policy.ts');
const appPolicy=load('src/lib/rider-application-policy.ts'),registration=load('src/lib/rider-registration.ts',{'./rider-application-policy':appPolicy});
function nodes(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function text(tree){return nodes(tree).flatMap(node=>[node.props?.children].flat().filter(value=>typeof value==='string'||typeof value==='number')).join(' ');}
const cash={type:'DELIVERY',paymentMethod:'CASH',paymentStatus:'UNPAID',status:'IN_TRANSIT',dropoffReachedAt:'2026-10-30T01:00:00Z',totalFare:162,customerPaidAt:null,customerPaidAmount:null,riderReceivedAt:null,riderReceivedAmount:null,paidAt:null,paymentReference:null};
function paymentHarness(record=cash,summaryOnly=false){
 const slots=[],effects=[],requests=[],handlers={};let index=0,getReply,postReply,intervals=0;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??={current:initial};},useEffect(callback){const i=index++;if(!(i in slots)){slots[i]=true;effects.push(callback);}}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const module=load('src/components/fetchit/shared/payment-card.tsx',{'react':hooks,'react/jsx-runtime':runtime,'@/components/ui/button':{Button:'button'},'@/lib/payment-policy':policy},{document:{hidden:false},navigator:{onLine:true},setInterval(){intervals++;return 1;},clearInterval(){},window:{addEventListener(name,fn){handlers[name]=fn;},removeEventListener(){},location:{assign(){}}},fetch:async(url,options={})=>{requests.push({url,...options});return options.method==='POST'?(postReply?.()??Response.json({booking:record})):(getReply?.()??Response.json({booking:record}));}});
 const render=()=>{index=0;return module.PaymentCard({bookingId:'fixture',role:'RIDER',summaryOnly});};render();effects.forEach(effect=>effect());
 return{render,requests,handlers,find:(type,label)=>nodes(render()).find(node=>node.type===type&&(!label||node.props.children===label)),setGet:fn=>getReply=fn,setPost:fn=>postReply=fn,get intervals(){return intervals;},async ready(){await new Promise(resolve=>setImmediate(resolve));render();}};
}
test('unknown availability is distinct from offline; next navigation follows the stage',()=>{
 assert.equal(ui.availabilityLabel(null),'Checking availability…');assert.equal(ui.availabilityLabel(false),'Offline');assert.equal(ui.availabilityLabel(true),'Online');
 const job={pickupLabel:'Pickup',dropoffLabel:'Destination'};
 assert.equal(ui.nextJobStop({...job,status:'ACCEPTED'}).navigation,'pickup');for(const status of ['PICKED_UP','IN_TRANSIT'])assert.equal(ui.nextJobStop({...job,status}).navigation,'dropoff');
});
test('pickup-code feedback distinguishes a mismatch from expiry without hiding attempt limits',()=>{
 assert.match(ui.pickupCodeFeedback('Pickup code did not match. Confirm it with the passenger.'),/Check the six digits/);
 assert.match(ui.pickupCodeFeedback('Ask the passenger to reveal a new pickup code.'),/unavailable or expired/);
 const limit='Too many incorrect attempts. Wait for expiry and ask for a new pickup code.';assert.equal(ui.pickupCodeFeedback(limit),limit);
});
test('schedule and age labels use the intended clock and do not silently expire jobs',()=>{
 const now=Date.parse('2026-10-30T02:00:00Z');
 assert.equal(ui.jobTiming({scheduledAt:'2026-10-30T03:00:00Z',createdAt:'2026-10-30T00:00:00Z'},now).kind,'upcoming');
 assert.equal(ui.jobTiming({scheduledAt:'2026-10-29T03:00:00Z',createdAt:'2026-10-29T00:00:00Z'},now).kind,'overdue');
 assert.equal(ui.jobTiming({scheduledAt:null,createdAt:'2026-10-29T00:00:00Z'},now).kind,'older');assert.equal(ui.isHistoryJob({status:'PENDING'}),false);
 assert.match(ui.formatJobTime('2026-10-30T02:00:00Z'),/10:00/);
});
test('history search combines reference/address with the selected outcome',()=>{
 const rows=[{refCode:'FIT-A',pickupLabel:'Lingayen',dropoffLabel:'Dagupan',status:'DELIVERED'},{refCode:'RIDE-B',pickupLabel:'Lingayen',dropoffLabel:'Binmaley',status:'CANCELLED'}];
 assert.deepEqual(ui.filterHistoryJobs(rows,'  lingAYen  ','DELIVERED'),[rows[0]]);assert.deepEqual(ui.filterHistoryJobs(rows,'ride-b','ALL'),[rows[1]]);assert.equal(ui.filterHistoryJobs(rows,'Dagupan','CANCELLED').length,0);
});
test('historical payment is fetched read-only, with no cash mutation form or timer',async()=>{
 const h=paymentHarness({...cash,status:'DELIVERED',dropoffReachedAt:null},true);await h.ready();
 assert.match(text(h.render()),/Payment confirmation incomplete/);assert.equal(h.find('form'),undefined);assert.equal(h.intervals,0);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});
test('cash controls remain locked before arrival and appear only at the correct stage',async()=>{
 for(const status of ['ACCEPTED','PICKED_UP','IN_TRANSIT']){const h=paymentHarness({...cash,status,dropoffReachedAt:null});await h.ready();assert.equal(h.find('form'),undefined,status);}
 const h=paymentHarness();await h.ready();assert(h.find('form'));assert.equal(h.find('button','I’m at drop-off'),undefined);
});
test('an amount different from the fare is explained before any POST',async()=>{
 const h=paymentHarness();await h.ready();h.find('input').props.onChange({target:{value:'100'}});await h.find('form').props.onSubmit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,0);assert.match(text(h.render()),/fare is ₱162.00/);
});
test('double taps send one confirmation, preserve pending state and explain the customer dependency',async()=>{
 const h=paymentHarness();await h.ready();let finish;h.setPost(()=>new Promise(resolve=>{finish=resolve;}));const form=h.find('form');const a=form.props.onSubmit({preventDefault(){}}),b=form.props.onSubmit({preventDefault(){}});assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
 finish(Response.json({booking:{...cash,riderReceivedAt:'2026-10-30T02:00:00Z',riderReceivedAmount:162,paymentStatus:'PENDING'}}));await Promise.all([a,b]);assert.equal(h.find('form'),undefined);assert.match(text(h.render()),/Waiting for the customer to confirm/);
});
test('a stale payment poll cannot overwrite a newer confirmation',async()=>{
 const h=paymentHarness();await h.ready();let release;h.setGet(()=>new Promise(resolve=>{release=resolve;}));const poll=h.handlers.focus();h.setPost(()=>Response.json({booking:{...cash,riderReceivedAt:'2026-10-30T02:00:00Z',riderReceivedAmount:162,paymentStatus:'PENDING'}}));await h.find('form').props.onSubmit({preventDefault(){}});release(Response.json({booking:cash}));await poll;assert.equal(h.find('form'),undefined);assert.match(text(h.render()),/Your cash confirmation is saved/);
});
test('requirement issues carry a concrete focus target for missing fields and documents',()=>{
 const application={status:'DRAFT',emailVerifiedAt:'2026-10-30T00:00:00Z',fields:{},fieldReviews:{},documents:[]};const issues=registration.registrationIssues(application,'MOTORCYCLE',['DELIVERY'],{});
 assert(issues.some(issue=>issue.field==='legalName'));assert(issues.some(issue=>issue.documentKind==='CR'));assert(issues.some(issue=>issue.documentKind==='NBI'));
});
test('signature capture keeps rapid pointer points and notifies outside state updaters',()=>{
 const slots=[],changes=[];let index=0,inUpdater=false;
 const hooks={useRef(initial){const i=index++;return slots[i]??={current:initial};},useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{if(typeof value==='function'){inUpdater=true;try{slots[i]=value(slots[i]);}finally{inUpdater=false;}}else slots[i]=value;}];}};
 const module=load('src/components/fetchit/shared/signature-pad.tsx',{'react':hooks,'lucide-react':{Eraser:'icon'},'@/components/ui/button':{Button:'button'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}});
 const render=()=>{index=0;const tree=module.SignaturePad({onChange:value=>{assert.equal(inUpdater,false,'Parent must not update during a child state updater');changes.push(value);}});const svg=nodes(tree).find(node=>node.type==='svg');svg.props.ref.current={getBoundingClientRect:()=>({left:0,top:0,width:300,height:100})};return{tree,svg};};
 const event=(x,y)=>({clientX:x,clientY:y,pointerId:1,preventDefault(){},target:{setPointerCapture(){}}});
 const {svg}=render();svg.props.onPointerDown(event(10,10));svg.props.onPointerMove(event(30,20));svg.props.onPointerMove(event(40,25));svg.props.onPointerUp(event(40,25));
 assert.equal(changes.length,1);assert.match(changes[0],/M 10 10.*L 30 20.*L 40 25/);svg.props.onPointerUp(event(40,25));assert.equal(changes.length,1);
 const clear=nodes(render().tree).find(node=>node.type==='button'&&node.props.title==='Clear');clear.props.onClick();assert.equal(changes.at(-1),null);
});
