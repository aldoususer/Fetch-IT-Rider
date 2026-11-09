const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function authFixture(respond=async()=>Response.json({user:null}),confirm=true){
 let state;const owners=[],cache=new Map();const exports={};
 const create=init=>{state=init(value=>{state={...state,...value};},()=>state);const hook=fn=>fn(state);hook.getState=()=>state;return hook;};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/store.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,fetch:respond,window:{confirm:()=>confirm},localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},require:name=>name==='zustand'?{create}:name==='./proof-drafts'?{setProofDraftOwner:owner=>owners.push(owner)}:{setRiderPushAccount:async()=>{}}});
 return {get state(){return state;},owners,cache};
}
const rider={id:'rider-a',role:'RIDER',name:'Rider'};
test('a temporary auth outage does not erase a saved proof draft during startup',async()=>{
 const h=authFixture(async()=>Response.json({error:'Unavailable'},{status:503}));await h.state.bootstrap();assert.equal(h.state.bootstrapped,true);assert.deepEqual(h.owners,[]);
});
test('cancelling logout retains the rider and proof; confirmed logout clears its cache owner',async()=>{
 const cancelled=authFixture(undefined,false);cancelled.state.setUser(rider);await cancelled.state.logout();assert.equal(cancelled.state.user.id,rider.id);assert.deepEqual(cancelled.owners,[rider.id]);
 const h=authFixture(async()=>{throw Error('Offline');});h.state.setUser(rider);await h.state.logout();assert.equal(h.state.user,null);assert.deepEqual(h.owners,[rider.id,null]);assert.equal(h.cache.get('fetchit:rider:pending-logout'),'1');
});
test('an auth response arriving after logout cannot reactivate old proof access',async()=>{
 let reply;const h=authFixture(url=>url==='/api/auth/me'?new Promise(resolve=>reply=resolve):Promise.resolve(Response.json({ok:true})));
 const boot=h.state.bootstrap();await h.state.logout();reply(Response.json({user:rider}));await boot;assert.equal(h.state.user,null);assert.deepEqual(h.owners,[null]);
});
test('proof cache ownership follows successful sign-in and rejects non-rider accounts',()=>{
 const h=authFixture();h.state.setUser(rider);h.state.setUser({...rider,id:'rider-b'});h.state.setUser({...rider,role:'CUSTOMER'});assert.deepEqual(h.owners,['rider-a','rider-b',null]);assert.equal(h.state.user,null);
});
const ast=ts.createSourceFile('dashboard.tsx',fs.readFileSync('src/components/fetchit/rider/rider-dashboard.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='EmptyJobs');
const jsx=(type,props)=>({type,props}),out={};
vm.runInNewContext(ts.transpileModule(fn.getText(ast)+'\nexports.EmptyJobs=EmptyJobs;',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:()=>({jsx,jsxs:jsx}),Card:'Card',CardContent:'CardContent',Clock:'Clock',Package:'Package',Button:'Button',PowerCircle:'PowerCircle'});
function nodes(n){return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(n.props?.children):'';
const defaults={tab:'available',connected:true,isOnline:true,activeJobs:0,paused:false,onGoOnline(){},onResume(){},onFindJobs(){},onActiveJobs(){}};
test('no internet is distinct from rider availability and offers no misleading Go online action',()=>{
 const tree=out.EmptyJobs({...defaults,connected:false,isOnline:false});assert.match(text(tree),/Connect to check your jobs/);assert.equal(nodes(tree).filter(n=>n.type==='Button').length,0);
 const online=out.EmptyJobs(defaults);assert.match(text(online),/No nearby requests right now/);
});
test('rider offline, paused matching and current job states each offer one relevant action',()=>{
 for(const [props,label] of [[{isOnline:false},'Go online'],[{paused:true,pauseReason:'Restore location'},'Resume receiving jobs'],[{activeJobs:1},'Continue active job']]){
  const tree=out.EmptyJobs({...defaults,...props}),buttons=nodes(tree).filter(n=>n.type==='Button');assert.equal(buttons.length,1);assert.match(text(buttons[0]),new RegExp(label));
 }
});
test('empty active and history screens provide a direct path to available jobs',()=>{
 for(const tab of ['active','history']){let calls=0;const tree=out.EmptyJobs({...defaults,tab,onFindJobs:()=>calls++});nodes(tree).find(n=>n.type==='Button').props.onClick();assert.equal(calls,1);}
});
