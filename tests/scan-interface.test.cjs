'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),bin=path.join(root,'bin/preprocess-review.cjs');
const tmp=fs.mkdtempSync(path.join(__dirname,'.scan-interface-'));
const run=args=>cp.spawnSync(process.execPath,[bin,...args],{cwd:tmp,encoding:'utf8',timeout:10000});
test.after(()=>{const r=fs.realpathSync(tmp);assert.equal(path.dirname(r),fs.realpathSync(__dirname));assert.ok(path.basename(r).startsWith('.scan-interface-'));fs.rmSync(r,{recursive:true,force:true});});
test('scan has command, global and help-topic discovery',()=>{
 for(const args of [['--help'],['help','scan'],['scan','--help']]){const r=run(args);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/scan/);}
});
test('scan executes synthetic functions and exposes the clean-versus-attack counterexample',()=>{
 const r=run(['scan','--demo','--format','json']);assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);
 assert.equal(p.provenance,'synthetic');assert.equal(p.analysis.metrics.cleanErrorCandidate.rate,0);assert.equal(p.analysis.metrics.attackSuccessBaseline.rate,0);assert.equal(p.analysis.metrics.attackSuccessCandidate.rate,1);assert.equal(p.analysis.risk.level,'HIGH');
 assert.equal(p.analysis.metrics.attackSuccessCandidate.interval,null);
 assert.equal(p.artifacts.length,0);assert.match(p.scope.evaluation,/synthetic/);
});
test('demo text discloses synthetic source and scoped empirical rates',()=>{
 const r=run(['scan','--demo']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/합성/);assert.match(r.stdout,/100\.00%/);assert.match(r.stdout,/운영 사고확률/);assert.doesNotMatch(r.stdout,/undefined|NaN/);
});
test('scan strict preserves the full report and uses attention status',()=>{
 const r=run(['scan','--demo','--strict','--format','json']);assert.equal(r.status,2,r.stderr);assert.equal(JSON.parse(r.stdout).analysis.risk.level,'HIGH');
});
test('scan missing artifacts fails instead of manufacturing a diagnostic',()=>{
 const r=run(['scan','--format','json']);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/before\.joblib/);
});
test('scan reports cannot silently overwrite existing files',()=>{
 const out=path.join(tmp,'report.json');let r=run(['scan','--demo','--format','json','--out',out]);assert.equal(r.status,0,r.stderr);const before=fs.readFileSync(out,'utf8');
 r=run(['scan','--demo','--out',out]);assert.equal(r.status,1);assert.equal(fs.readFileSync(out,'utf8'),before);
 r=run(['scan','--demo','--format','json','--out',out,'--force']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).toolVersion,require('../package.json').version);
});
test('scan rejects ambiguous execution arguments before loading a model',()=>{
 for(const args of [['--format','md'],['--demo','--before','before.joblib'],['--demo','--assume-iid'],['--timeout-seconds','0'],['--timeout-seconds','Infinity'],['--label','id'],['--force'],['--demo','--demo'],['--attacks'],['--unknown']]){const r=run(['scan',...args]);assert.equal(r.status,1,args.join(' '));assert.equal(r.stdout,'');}
});
test('scan refuses replacing a model even with force',()=>{
 const before=path.join(tmp,'before.joblib'),after=path.join(tmp,'after.joblib'),data=path.join(tmp,'evaluation.csv');
 for(const f of [before,after,data])fs.writeFileSync(f,'sentinel');
 const r=run(['scan','--out',before,'--force']);assert.equal(r.status,1);assert.match(r.stderr,/덮어쓸 수 없습니다/);assert.equal(fs.readFileSync(before,'utf8'),'sentinel');
});
