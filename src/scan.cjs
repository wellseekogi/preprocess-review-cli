'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const VERSION = require('../package.json').version;

function usage() {
  return `preprocess-review ${VERSION} — scan 자동 측정\n\n사용법:\n  preprocess-review scan [folder]\n  preprocess-review scan --before before.joblib --after after.joblib --data evaluation.csv [--attacks attacks.csv]\n  preprocess-review scan --demo\n\n기본 파일명: before.joblib, after.joblib, evaluation.csv, attacks.csv(있을 때만).\n실제 모델 평가: Python + requirements-scan.txt 의존성이 필요합니다.\n신뢰하는 로컬 scikit-learn 모델/전처리 Pipeline만 지정하세요. joblib 로딩은 Python 코드를 실행할 수 있습니다.\n지원 입력: 숫자 특성의 분류 문제. 정상 CSV는 id,label,특성 열; 공격 CSV는 id,clean_id,attack_target,동일 특성 열.\n\n옵션:\n  --python PATH       평가 환경의 Python 실행 파일 (또는 PREPROCESS_REVIEW_PYTHON 환경 변수)\n  --label NAME        정답 열 이름, 기본 label\n  --id NAME           정상/공격 행 ID 열 이름, 기본 id\n  --format text|json  기본 text\n  --out FILE          보고서 저장 (--force로 기존 보고서 교체)\n  --strict            LOW_WITHIN_TESTED_SCOPE 외의 결과는 종료 코드 2\n  --assume-iid        독립·동일분포 표집을 사용자가 가정할 때만 Wilson 95% 구간 표시\n  --timeout-seconds N 실제 평가 제한 시간, 기본 120초, 최대 3600초\n  --demo              내장된 합성 전처리/분류 함수를 실제 실행하는 예제 (사용자 모델 진단 아님)\n\n출력 비율은 제공한 평가 표본에서 관측한 빈도입니다. 실제 운영 사고확률이나 법적 재인증 판정이 아닙니다.\n공격 자료가 없으면 공격 위험은 미평가로 표시합니다. 위험 등급은 명시된 보수적 회귀 검사 규칙입니다.\n종료 코드: 실행 완료 0 / 입력·실행 오류 1 / --strict 검토 필요 2.\n`;
}
function parse(argv) {
  const o = {format:'text',label:'label',id:'id',strict:false,force:false,demo:false,iid:false,timeout:120};
  const seen = new Set();
  const valueFlags = new Set(['--before','--after','--data','--attacks','--python','--label','--id','--format','--out','--timeout-seconds']);
  const booleanFlags = new Set(['--strict','--force','--demo','--assume-iid']);
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if (a==='--help'||a==='-h') return {help:true};
    if (a==='--version'||a==='-v') return {version:true};
    if (valueFlags.has(a)||booleanFlags.has(a)) {
      if (seen.has(a)) throw new Error('중복 옵션: '+a);
      seen.add(a);
      if(booleanFlags.has(a)) o[a==='--assume-iid'?'iid':a.slice(2)]=true;
      else {
        const v=argv[++i];
        if(!v||v.startsWith('-')||/[\u0000-\u001f]/.test(v)) throw new Error(a+'의 값이 올바르지 않습니다.');
        o[a==='--timeout-seconds'?'timeout':a.slice(2)]=v;
      }
    } else if(a.startsWith('-')) throw new Error('알 수 없는 scan 옵션: '+a);
    else if(o.folder!==undefined) throw new Error('scan은 프로젝트 폴더를 하나만 받습니다.');
    else o.folder=a;
  }
  if(!['text','json'].includes(o.format)) throw new Error('scan --format은 text 또는 json입니다.');
  if(o.force&&!o.out) throw new Error('--force에는 --out이 필요합니다.');
  o.timeout=Number(o.timeout);
  if(!Number.isInteger(o.timeout)||o.timeout<1||o.timeout>3600) throw new Error('제한 시간은 1~3600초 정수여야 합니다.');
  if(o.demo && (o.folder||['--before','--after','--data','--attacks','--label','--id','--python','--assume-iid'].some(x=>seen.has(x)))) throw new Error('--demo는 모델·데이터 옵션이나 --assume-iid와 함께 사용할 수 없습니다.');
  if(o.label===o.id) throw new Error('정답 열과 ID 열은 서로 달라야 합니다.');
  return o;
}
function protectOutput(o, inputs) {
  if(!o.out) return;
  const target=path.resolve(o.out),parent=fs.realpathSync(path.dirname(target));
  const canonical=path.join(parent,path.basename(target));
  const eq=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  let stat;
  try {stat=fs.lstatSync(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(stat && (stat.isSymbolicLink()||!stat.isFile())) throw new Error('출력은 일반 파일이어야 합니다.');
  if(stat&&!o.force) throw new Error('출력 파일이 이미 있습니다. 교체하려면 --force를 사용하세요.');
  for(const f of inputs){
    const real=fs.realpathSync(f),s=fs.statSync(f);
    if(eq(canonical,real)||(stat&&s.dev===stat.dev&&s.ino===stat.ino)) throw new Error('모델·평가 입력 파일은 보고서로 덮어쓸 수 없습니다.');
  }
}
function demo() {
  const predict=x=>x[0]+2*x[1]>0?'1':'0';
  const before=x=>predict([x[0],0]);
  const after=x=>predict(x.slice());
  const clean=[],attacks=[];
  for(let i=0;i<200;i++){
    const label=i<100?'0':'1',signal=(label==='0'?-1:1)*(0.1+(i%100)/100);
    const id='synthetic-'+i,x=[signal,0];
    clean.push({id,label,baseline:before(x),candidate:after(x)});
    if(label==='0'){
      const attacked=[signal,1];
      attacks.push({id:'attack-'+i,cleanId:id,target:'1',baseline:before(attacked),candidate:after(attacked)});
    }
  }
  return {schemaVersion:1,provenance:'synthetic',samplingAssumption:'unspecified',clean,attacks,artifacts:[],runtime:{node:process.version},scope:{evaluation:'Executed synthetic deterministic classifier and preprocessing functions; not the paper experiment or the user model',attackSemantics:'one artificial trigger per non-target clean sample',limitations:['고정 합성 예제이며 운영 분포의 무작위 표본이 아닙니다.']}};
}
function execute(o) {
  if(o.demo){protectOutput(o,[]);return demo();}
  const folder=path.resolve(o.folder||'.');
  if(!fs.statSync(folder).isDirectory()) throw new Error('프로젝트 경로는 폴더여야 합니다.');
  const resolve=(value,defaultName)=>path.resolve(folder,value||defaultName);
  const before=resolve(o.before,'before.joblib'),after=resolve(o.after,'after.joblib'),data=resolve(o.data,'evaluation.csv');
  const defaultAttack=path.join(folder,'attacks.csv');
  const attacks=o.attacks?resolve(o.attacks):fs.existsSync(defaultAttack)?defaultAttack:null;
  const inputs=[before,after,data,...(attacks?[attacks]:[])];
  for(const f of inputs){
    if(!fs.existsSync(f)) throw new Error('평가에 필요한 파일이 없습니다: '+f+'\nscan --help에서 입력 형식을 확인하세요. 동작 예제는 scan --demo입니다.');
    if(!fs.statSync(f).isFile()) throw new Error('평가 입력은 일반 파일이어야 합니다: '+f);
  }
  protectOutput(o,inputs);
  const python=o.python||process.env.PREPROCESS_REVIEW_PYTHON||(process.platform==='win32'?'python':'python3');
  const args=[path.join(__dirname,'../python/runner.py'),'--before',before,'--after',after,'--data',data,'--label',o.label,'--id',o.id];
  if(attacks)args.push('--attacks',attacks);
  const result=cp.spawnSync(python,args,{encoding:'utf8',timeout:o.timeout*1000,maxBuffer:64*1024*1024,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});
  if(result.error) throw new Error('Python 평가 실행 실패: '+result.error.message+' (--python으로 평가 환경을 지정할 수 있습니다.)');
  if(result.status!==0) throw new Error('실제 모델 평가 실패: '+(result.stderr||'출력 없음').slice(0,6000));
  let payload;
  try{payload=JSON.parse(result.stdout);}catch{throw new Error('Python 평가기의 출력이 유효한 JSON이 아닙니다.');}
  payload.samplingAssumption=o.iid?'iid':'unspecified';
  if(result.stderr.trim())payload.runnerWarnings=result.stderr.trim().slice(0,6000);
  return payload;
}
function pct(n){return n===null||n===undefined?'미측정':(n*100).toFixed(2)+'%';}
function render(report,display) {
  const a=report.analysis,m=a.metrics;
  const lines=['전처리 변경 자동 진단',report.provenance==='synthetic'?'대상: 내장 합성 실행 예제 (사용자 모델 진단 아님)':'대상: 지정한 변경 전후 모델과 평가 데이터','', '위험 수준: '+display(a.risk.label),''];
  function metric(label,value){
    let line=label+': '+pct(value.rate);
    line+=value.denominator?' ('+value.numerator+'/'+value.denominator+')':' (유효 표본 없음)';
    if(value.interval)line+=' | Wilson 95% 구간 '+pct(value.interval.lower)+'~'+pct(value.interval.upper);
    lines.push(line);
  }
  metric('정상 오류율 · 변경 전',m.cleanErrorBaseline);
  metric('정상 오류율 · 변경 후',m.cleanErrorCandidate);
  metric('정상 예측 변경률',m.disagreement);
  metric('정답에서 오답으로 바뀐 비율 · 전체 표본',m.harmfulRegressionAll);
  lines.push('');
  metric('공격 성공률 · 변경 전',m.attackSuccessBaseline);
  metric('공격 성공률 · 변경 후',m.attackSuccessCandidate);
  metric('변경 후 새로 성공한 공격 비율',m.introducedAttackSuccess);
  lines.push('공격 비율의 분모: 변경 전 정상 예측이 정답이고, 정답이 공격 목표와 다른 대응 표본.');
  lines.push('');
  for(const r of a.risk.reasons)lines.push('판정 이유: '+display(typeof r==='string'?r:r.detail));
  lines.push('평가한 정상 표본 '+a.sufficiency.clean.count+'개 / 유효 공격 표본 '+a.sufficiency.eligibleAttacks.count+'개.');
  if(!a.sufficiency.sufficient)lines.push('시험 범위 부족: 정상·공격 각각 '+a.policy.minSamples+'개라는 연구용 최소 기준을 충족하지 못했습니다.');
  lines.push('등급은 관측된 변화에 대한 보수적 검사 규칙입니다. 최소 표본 기준은 연구용 설정이며 운영 사고확률을 추정하지 않습니다.');
  if(report.runnerWarnings)lines.push('평가 실행 경고: '+display(report.runnerWarnings));
  lines.push(report.samplingAssumption==='iid'?'신뢰구간은 사용자가 지정한 독립·동일분포 표집 가정에 조건부입니다. 대표성을 자동 확인하지 않습니다.':'표시된 %는 이 평가 표본의 관측 비율입니다. 표집 가정이 없어 모집단 확률의 신뢰구간은 표시하지 않습니다.');
  lines.push('공격 자료가 없으면 보안 위험은 미평가입니다. 준비되지 않은 공격과 법적 재인증 여부는 자동 판정하지 않습니다.','');
  return lines.join('\n');
}
function run(argv,{stdout,stderr,writeResult,display}) {
  const o=parse(argv);
  if(o.help){stdout.write(usage());return 0;}
  if(o.version){stdout.write('preprocess-review '+VERSION+'\n');return 0;}
  const payload=execute(o);
  const {schemaVersion,provenance,samplingAssumption,clean,attacks}=payload;
  const analysis=require('./scan-metrics.cjs').analyze({schemaVersion,provenance,samplingAssumption,clean,...(attacks===undefined?{}:{attacks})});
  const report={reportSchemaVersion:1,toolVersion:VERSION,assessedAt:new Date().toISOString(),provenance:payload.provenance,samplingAssumption:payload.samplingAssumption,analysis,artifacts:payload.artifacts||[],runtime:payload.runtime||{},runMetadata:payload.runMetadata||{},scope:payload.scope||{},runnerWarnings:payload.runnerWarnings||null};
  const text=o.format==='json'?JSON.stringify(report,null,2)+'\n':render(report,display);
  writeResult(text,o,null,stdout);
  return o.strict && analysis.risk.level!=='LOW_WITHIN_TESTED_SCOPE'?2:0;
}
module.exports={usage,parse,demo,execute,render,run};
