const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rider-next-action.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports});
