'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/engine.cjs');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/cases.json'),'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const good = () => clone(cases.find(c=>c.metadata.id==='synthetic-exact-reuse'));
const fixed = {now:'2026-09-16T12:00:00.000Z'};

test('paper counterexample is invalidated without invented fingerprints',()=>{
  const c = clone(cases[0]);
  const r=engine.assess(c,fixed);
  assert.equal(r.technical.code,'INVALIDATED');
  assert.equal(r.regulatory.code,'OUT_OF_SCOPE');
  assert.equal(r.input.metadata.provenance,'paper');
  assert.ok(Object.values(r.input.evidence.fingerprints.before).every(v=>v===''));
});
test('complete identical fixed-evaluation evidence permits only scoped reuse',()=>{
  const r=engine.assess(good(),fixed);
  assert.equal(r.technical.code,'REUSE_SCOPED');
  assert.equal(r.regulatory.code,'DOCUMENTED_PATH');
  assert.equal(r.technical.comparisons.length,6);
  assert.ok(r.limitations.length>0);
  assert.equal(r.ruleVersion,'0.1.0');
});
test('every missing fingerprint blocks reuse, including both missing together',()=>{
  for(const key of engine.FINGERPRINT_KEYS){
    for(const side of ['before','after','both']){
      const c=good();
      if(side!=='after') c.evidence.fingerprints.before[key]='';
      if(side!=='before') c.evidence.fingerprints.after[key]='';
      const r=engine.assess(c,fixed);
      assert.equal(r.technical.code,'HOLD',key+' '+side);
    }
  }
});
test('every changed evaluation component requires retesting even when routine tests pass',()=>{
  for(const key of engine.FINGERPRINT_KEYS){
    const c=good();c.evidence.fingerprints.after[key]='f'.repeat(64);
    c.change.tests=c.change.tests.map(t=>({...t,status:'pass',reference:'declared passing check'}));
    assert.equal(engine.assess(c,fixed).technical.code,'RETEST_REQUIRED',key);
  }
});
test('case-only differences in valid SHA256 strings do not force retest',()=>{
  const c=good();
  for(const key of engine.FINGERPRINT_KEYS)c.evidence.fingerprints.after[key]=c.evidence.fingerprints.after[key].toUpperCase();
  assert.equal(engine.assess(c,fixed).technical.code,'REUSE_SCOPED');
});
test('a failed check overrides identical fingerprints and a documented plan',()=>{
  for(const domain of ['security','quality','fairness','privacy','oversight']){
    const c=good();c.change.tests=[{domain,status:'fail',reference:'test result',note:''}];
    const r=engine.assess(c,fixed);
    assert.equal(r.technical.code,'INVALIDATED',domain);
    assert.equal(r.regulatory.code,'REVIEW_REQUIRED',domain);
  }
});
test('known regression overrides all positive reuse declarations',()=>{
  const c=good();c.change.knownRegression='yes';
  assert.equal(engine.assess(c,fixed).technical.code,'INVALIDATED');
});
test('missing epistemic preconditions do not silently default to safe',()=>{
  const paths=[['evidence','baselinePassed'],['evidence','deterministic'],['evidence','dependencyCoverage'],['evidence','evaluationScopeUnchanged'],['change','safeguardsChanged'],['change','inputPopulationChanged'],['change','knownRegression'],['context','intendedPurposeChanged']];
  for(const [section,key]of paths){
    const c=good();delete c[section][key];
    assert.equal(engine.assess(c,fixed).technical.code,'HOLD',section+'.'+key);
  }
});
test('unsupported references and claims cannot justify reuse',()=>{
  for(const key of ['claim','evidenceReference']){
    const c=good();c.evidence[key]='   ';
    assert.equal(engine.assess(c,fixed).technical.code,'HOLD',key);
  }
});
test('no passing baseline means there is no passing result to reuse',()=>{
  const c=good();c.evidence.baselinePassed='no';
  assert.equal(engine.assess(c,fixed).technical.code,'HOLD');
});
test('non-deterministic or incomplete dependency model demands new evaluation',()=>{
  for(const key of ['deterministic','dependencyCoverage']){
    const c=good();c.evidence[key]='no';
    assert.equal(engine.assess(c,fixed).technical.code,'RETEST_REQUIRED');
  }
});
test('population and safeguard changes cannot be hidden behind equal file hashes',()=>{
  for(const key of ['safeguardsChanged','inputPopulationChanged']){
    const c=good();c.change[key]='yes';
    assert.equal(engine.assess(c,fixed).technical.code,'RETEST_REQUIRED');
  }
});
test('purpose change escalates even a previously non-high-risk declaration',()=>{
  const c=good();c.context.euHighRisk='no';c.context.intendedPurposeChanged='yes';
  const r=engine.assess(c,fixed);
  assert.equal(r.technical.code,'RETEST_REQUIRED');
  assert.equal(r.regulatory.code,'REVIEW_REQUIRED');
});
test('fixed-evaluation reuse and regulatory review can coexist',()=>{
  const c=good();c.context.plannedChange='unknown';c.context.planReference='';
  const r=engine.assess(c,fixed);
  assert.equal(r.technical.code,'REUSE_SCOPED');
  assert.equal(r.regulatory.code,'REVIEW_REQUIRED');
});
test('planned change without a referenced plan does not imply a documented route',()=>{
  const c=good();c.context.planReference='';
  assert.equal(engine.assess(c,fixed).regulatory.code,'REVIEW_REQUIRED');
});
test('legal applicability gaps remain context required',()=>{
  for(const key of ['euHighRisk','placedOnMarket','priorAssessment','complianceImpact']){
    const c=good();c.context[key]='unknown';
    assert.equal(engine.assess(c,fixed).regulatory.code,'CONTEXT_REQUIRED',key);
  }
});
test('known non-high-risk no-purpose-change case is outside only the selected article path',()=>{
  const c=good();c.context.euHighRisk='no';
  assert.equal(engine.assess(c,fixed).regulatory.code,'OUT_OF_SCOPE');
});
test('blank template holds without treating unknowns as negative answers',()=>{
  const c=engine.emptyCase();const r=engine.assess(c,fixed);
  assert.equal(r.technical.code,'HOLD');
  assert.equal(r.regulatory.code,'CONTEXT_REQUIRED');
});
test('malformed known schema fields are rejected and cannot permit reuse',()=>{
  const invalid=[null,[],true,'text',Object.assign(good(),{schemaVersion:'99'}),Object.assign(good(),{change:[]})];
  const badTri=good();badTri.evidence.deterministic='true';invalid.push(badTri);
  const badHash=good();badHash.evidence.fingerprints.before.inputs='not-a-hash';invalid.push(badHash);
  const badTests=good();badTests.change.tests=[{domain:'security',status:'passed'}];invalid.push(badTests);
  for(const c of invalid){
    assert.equal(engine.validate(c).valid,false,JSON.stringify(c));
    assert.equal(engine.assess(c,fixed).technical.code,'HOLD');
  }
});
test('assessment is deterministic with injected time and does not mutate caller input',()=>{
  const c=good(), saved=clone(c);
  const a=engine.assess(c,fixed), b=engine.assess(c,fixed);
  assert.deepEqual(a,b);assert.deepEqual(c,saved);
  c.metadata.title='changed later';
  assert.notEqual(a.input.metadata.title,c.metadata.title);
  assert.equal(a.assessedAt,fixed.now);
});
test('Markdown report includes provenance, scoped claim, both results and rule version',()=>{
  const r=engine.assess(good(),fixed);const md=engine.toMarkdown(r);
  assert.equal(typeof md,'string');
  for(const text of [r.input.metadata.title,r.input.evidence.claim,r.technical.label,r.regulatory.label,r.ruleVersion])assert.ok(md.includes(text),text);
  assert.ok(md.includes('synthetic')||md.includes('가상')||md.includes('합성'));
});
test('all illustrative cases validate and have stable expected decisions',()=>{
  const expected=[['INVALIDATED','OUT_OF_SCOPE'],['REUSE_SCOPED','DOCUMENTED_PATH'],['RETEST_REQUIRED','CONTEXT_REQUIRED'],['HOLD','DOCUMENTED_PATH'],['RETEST_REQUIRED','DOCUMENTED_PATH'],['RETEST_REQUIRED','REVIEW_REQUIRED'],['HOLD','DOCUMENTED_PATH'],['INVALIDATED','REVIEW_REQUIRED'],['RETEST_REQUIRED','REVIEW_REQUIRED'],['REUSE_SCOPED','REVIEW_REQUIRED']];
  cases.forEach((c,i)=>{const r=engine.assess(c,fixed);assert.equal(r.validation.valid,true,c.metadata.id);assert.deepEqual([r.technical.code,r.regulatory.code],expected[i],c.metadata.id);});
});

test('unknown new purpose cannot preserve a previous non-high-risk classification by default',()=>{
  const c=good();c.context.euHighRisk='no';c.context.intendedPurposeChanged='unknown';
  assert.equal(engine.assess(c,fixed).regulatory.code,'CONTEXT_REQUIRED');
});
