const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const policy={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rider-next-action.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:policy});
const base={type:'RIDE',status:'IN_TRANSIT',pickupCode:'',paymentReady:false,proofOpen:false,customerPickupConfirmedAt:null,customerDropoffConfirmedAt:null};
test('an in-progress ride explains missing customer pickup before payment or completion',()=>{
 const action=policy.riderNextAction(base);assert.equal(action.kind,'confirmation');assert.match(action.hint,/pickup confirmation is missing/);
 assert.equal(policy.riderNextAction({...base,paymentReady:true}).kind,'confirmation');
});
test('the next action follows customer arrival, payment and completion in order',()=>{
 const boarded={...base,customerPickupConfirmedAt:'saved'};
 assert.match(policy.riderNextAction(boarded).hint,/arrival at drop-off/);
 const arrived={...boarded,customerDropoffConfirmedAt:'saved'};
 assert.equal(policy.riderNextAction(arrived).kind,'payment');
 assert.equal(policy.riderNextAction({...arrived,paymentReady:true}).kind,'advance');
});
test('a pickup code is verified before asking for customer boarding confirmation',()=>{
 assert.equal(policy.riderNextAction({...base,status:'ACCEPTED',pickupCode:'123'}).kind,'pickup');
 assert.equal(policy.riderNextAction({...base,status:'ACCEPTED',pickupCode:'123456'}).kind,'advance');
 assert.equal(policy.riderNextAction({...base,status:'PICKED_UP'}).kind,'confirmation');
 assert.equal(policy.riderNextAction({...base,status:'PICKED_UP',customerPickupConfirmedAt:'saved'}).kind,'advance');
});
test('deliveries require payment before opening or submitting proof',()=>{
 assert.equal(policy.riderNextAction({...base,type:'DELIVERY'}).kind,'payment');
 assert.equal(policy.riderNextAction({...base,type:'DELIVERY',paymentReady:true}).kind,'proof');
 assert.equal(policy.riderNextAction({...base,type:'DELIVERY',paymentReady:true,proofOpen:true}).kind,'submit-proof');
 assert.equal(policy.riderNextAction({...base,type:'DELIVERY',proofOpen:true}).kind,'payment');
});
test('the confirmation panel distinguishes verified codes from customer acknowledgement',()=>{
 const jsx=(type,props)=>({type,props}),module={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/fetchit/rider/customer-confirmation-checklist.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:module,encodeURIComponent,require:()=>({jsx,jsxs:jsx})});
 const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
 const panel=text(module.CustomerConfirmationChecklist({job:{...base,refCode:'TEST'}}));
 assert.match(panel,/trip is already in progress/);assert.match(panel,/Pickup-code verification is a separate check/);assert.doesNotMatch(panel,/Both customer confirmations are saved/);
 const done=text(module.CustomerConfirmationChecklist({job:{...base,refCode:'TEST',customerPickupConfirmedAt:'saved',customerDropoffConfirmedAt:'saved'}}));
 assert.match(done,/Both customer confirmations are saved/);assert.doesNotMatch(done,/confirmation is missing/);
});
