const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const policy={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rider-next-action.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:policy});
const base={type:'RIDE',status:'IN_TRANSIT',pickupCode:'',paymentReady:false,proofOpen:false,customerPickupConfirmedAt:null,customerDropoffConfirmedAt:null};
test('an in-progress ride explains missing customer pickup before payment or completion',()=>{
 const action=policy.riderNextAction(base);assert.equal(action.kind,'confirmation');assert.equal(action.label,'Waiting for boarding confirmation');assert.match(action.hint,/I’m on board/);
 assert.equal(policy.riderNextAction({...base,paymentReady:true}).kind,'confirmation');
});
test('the next action follows customer arrival, payment and completion in order',()=>{
 const boarded={...base,customerPickupConfirmedAt:'saved'};
 assert.match(policy.riderNextAction(boarded).hint,/I’ve arrived at drop-off/);
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
test('the confirmation panel names the passenger’s exact next action and offers contact',()=>{
 const jsx=(type,props)=>({type,props}),module={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/fetchit/rider/customer-confirmation-checklist.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:module,encodeURIComponent,require:()=>({jsx,jsxs:jsx})});
 const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
 const panel=text(module.CustomerConfirmationChecklist({job:{...base,refCode:'TEST',customer:{phone:'+630000000000'}},...policy.riderNextAction(base)}));
 assert.match(panel,/Waiting for boarding confirmation/);
 assert.match(panel,/I’m on board/);assert.match(panel,/Call passenger/);assert.match(panel,/Get help/);
 assert.doesNotMatch(panel,/Review customer confirmations|Waiting for drop-off/);
});
