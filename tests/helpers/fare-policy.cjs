const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];}});
  return exports;
}
module.exports=load('src/lib/fare-policy.ts',{'./payment-policy':load('src/lib/payment-policy.ts')});
