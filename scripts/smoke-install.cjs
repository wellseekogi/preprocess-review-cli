'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const npmCLI=process.env.npm_execpath;
if(!npmCLI||!fs.existsSync(npmCLI))throw new Error('Run this script using npm run smoke:install.');
const temp=fs.mkdtempSync(path.join(root,'.tmp-install-'));
const env={...process.env,npm_config_cache:path.join(temp,'cache'),npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_fund:'false'};
const npm=(args,cwd=root)=>{const r=cp.spawnSync(process.execPath,[npmCLI,...args],{cwd,env,encoding:'utf8'});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout;};
try{
 const pack=JSON.parse(npm(['pack','--json','--ignore-scripts','--offline','--pack-destination',temp]))[0];
 const tarball=path.join(temp,pack.filename);
 assert.ok(!pack.files.some(f=>/\.(html|css)$/.test(f.path)||/(^|\/)(app|examples)\.js$/.test(f.path)),'No browser files in installed package');
 const consumer=path.join(temp,'consumer');fs.mkdirSync(consumer);
 fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'local-install-check',version:'1.0.0',private:true}));
 npm(['install','--prefix',consumer,'--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',tarball],consumer);
 const installed=path.join(consumer,'node_modules',pkg.name);
 const entry=path.join(installed,'bin/preprocess-review.cjs');
 const run=(args)=>cp.spawnSync(process.execPath,[entry,...args],{cwd:consumer,env,encoding:'utf8'});
 const v=run(['--version']);assert.equal(v.status,0,v.stderr);assert.ok(v.stdout.includes(pkg.version));
 const casePath=path.join(installed,'examples/paper-mask-removal.json');
 const report=run(['check',casePath,'--format','json']);assert.equal(report.status,0,report.stderr);assert.equal(JSON.parse(report.stdout).technical.code,'INVALIDATED');
 const strict=run(['check',casePath,'--strict','--format','json']);assert.equal(strict.status,2,strict.stderr);
 const command=process.platform==='win32'?cp.spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c','.\\node_modules\\.bin\\preprocess-review.cmd --version'],{cwd:consumer,env,encoding:'utf8'}):cp.spawnSync(path.join(consumer,'node_modules/.bin/preprocess-review'),['--version'],{cwd:consumer,env,encoding:'utf8'});
 assert.equal(command.status,0,command.stderr);assert.ok(command.stdout.includes(pkg.version));
 console.log(JSON.stringify({package:pkg.name,version:pkg.version,node:process.version,platform:process.platform,tarballFiles:pack.files.length,offlineInstall:true,installedCommand:true,checks:['no browser files','version','JSON assessment','strict attention exit','installed command shim'],passed:5},null,2));
}finally{
 const resolved=path.resolve(temp);
 if(path.dirname(resolved)!==root||!path.basename(resolved).startsWith('.tmp-install-'))throw new Error('Unsafe cleanup path');
 fs.rmSync(resolved,{recursive:true,force:true});
}
