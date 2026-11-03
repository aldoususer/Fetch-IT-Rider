const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const boundary=ts.createSourceFile('application.tsx',fs.readFileSync('src/components/fetchit/rider/rider-application.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let request,requireSignIn;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='request')request=node.getText(boundary);if(ts.isVariableDeclaration(node)&&node.name.getText(boundary)==='requireSignIn')requireSignIn=node.initializer.arguments[0].getText(boundary);ts.forEachChild(node,visit);}visit(boundary);
function fixture(status){
  const app={sessionExpired:false,mutationVersion:{current:0},applicationRef:{current:{version:7,fields:{legalName:'Saved driver'}}},endpoint:'/api/rider/application',fetch:async()=>Response.json(status===200?{application:{version:8,fields:{legalName:'Saved driver'}}}:{error:'Sign in with a rider account.'},{status}),readApplicationJson:response=>response.json(),Error,Date,Number,Math,
    setSessionExpired:value=>{app.sessionExpired=value;},setError:value=>{app.error=value;},setPopup:value=>{app.popup=value;},setResendRemaining:value=>{app.wait=value;},setResendUntil(){},hydrate:value=>{app.applicationRef.current=value;}};
  vm.runInNewContext(ts.transpileModule(`const requireSignIn=${requireSignIn};\n${request}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,app);return app;
}
test('expired send-code and verify-code sessions open recovery and retain the application draft',async()=>{
  for(const action of ['send-code','verify-code']){const app=fixture(401);await assert.rejects(app.request({action}),/Sign in again/);assert.equal(app.sessionExpired,true);assert.equal(app.applicationRef.current.fields.legalName,'Saved driver');assert.equal(app.wait,undefined);}
});
test('normal rider verification continues without session recovery',async()=>{
  const app=fixture(200);await app.request({action:'send-code'});assert.equal(app.sessionExpired,false);assert.equal(app.wait,60);assert.equal(app.applicationRef.current.version,8);
});
test('expired code and email delivery errors do not sign the rider out',async()=>{
  for(const status of [400,429,503]){const app=fixture(status);await assert.rejects(app.request({action:'verify-code'}));assert.equal(app.sessionExpired,false);assert.equal(app.applicationRef.current.version,7);}
});
const authSource=fs.readFileSync('src/components/fetchit/shared/auth-view.tsx','utf8');
function authFixture(status=200){
  let cursor=0,tree,signedIn=0,user=null;const slots=[];const hooks={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value;}];}};
  const jsx=(type,props)=>({type,props});const exports={};
  vm.runInNewContext(ts.transpileModule(authSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,process:{env:{NODE_ENV:'production'}},fetch:async()=>Response.json(status===200?{user:{id:'rider'}}:{error:'Invalid email or password.'},{status}),require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/store'?{useAppStore:fn=>fn({setUser:value=>{user=value;},setView(){}})}:name==='@/hooks/use-local-demo'?{useLocalDemo:()=>({enabled:false})}:new Proxy({},{get:(_,key)=>key})});
  function render(){cursor=0;tree=exports.AuthView({initialMode:'login',initialEmail:'driver@example.invalid',signInNotice:'Your session expired.',onSignedIn:()=>{signedIn++;}});return tree;}
  function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
  render();return{render,nodes:()=>nodes(tree),get signedIn(){return signedIn;},get user(){return user;}};
}
test('recovery pre-fills the rider email and resumes only after successful authentication',async()=>{
  const app=authFixture();assert.equal(app.nodes().find(n=>n.props?.id==='email').props.value,'driver@example.invalid');
  assert.equal(app.nodes().find(n=>n.props?.value==='signup').props.disabled,true);
  await app.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(app.signedIn,1);assert.equal(app.user.id,'rider');
});
test('incorrect credentials keep rider recovery open',async()=>{
  const app=authFixture(401);await app.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});app.render();assert.equal(app.signedIn,0);assert.equal(app.user,null);assert(app.nodes().some(n=>n.props?.children==='Invalid email or password.'));
});
