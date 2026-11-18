const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const result={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ride-confirmation-policy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:result});
module.exports=result;
