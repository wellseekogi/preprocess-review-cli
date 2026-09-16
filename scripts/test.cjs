'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const tests=fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.cjs')).sort().map(n=>path.join(root,'tests',n));
if(!tests.length)throw new Error('No tests found.');
const result=cp.spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status===null?1:result.status;
