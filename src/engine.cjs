(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PreprocessReview = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.1.0';
  const FINGERPRINT_KEYS = Object.freeze(['model', 'inputs', 'labels', 'evaluator', 'policy', 'runtime']);
  const TRI = ['yes', 'no', 'unknown'];
  const TYPES = ['refactor', 'normalization', 'resize', 'missing_values', 'defense_removal', 'runtime', 'other'];
  const DOMAINS = ['security', 'quality', 'fairness', 'privacy', 'oversight'];
  const STATUSES = ['pass', 'fail', 'not_run', 'unknown'];
  const CONTEXT_TRI = ['euHighRisk', 'placedOnMarket', 'priorAssessment', 'plannedChange', 'intendedPurposeChanged', 'complianceImpact'];
  const EVIDENCE_TRI = ['baselinePassed', 'deterministic', 'dependencyCoverage', 'evaluationScopeUnchanged'];
  const CHANGE_TRI = ['safeguardsChanged', 'inputPopulationChanged', 'knownRegression'];
  const HASH = /^[a-fA-F0-9]{64}$/;
  const LABELS = {
    HOLD: '판단 보류 — 근거 보완 필요',
    INVALIDATED: '기존 평가 근거 무효화 — 실패 또는 회귀 확인',
    RETEST_REQUIRED: '관련 평가 재실행 필요',
    REUSE_SCOPED: '명시된 고정 평가에 한해 근거 재사용 가능',
    REVIEW_REQUIRED: '중대한 변경 관련 검토 필요',
    CONTEXT_REQUIRED: '규제 적용 맥락 보완 필요',
    OUT_OF_SCOPE: '제43조(4)의 해당 경로 적용 대상 밖',
    DOCUMENTED_PATH: '문서화된 변경 계획 검토 경로'
  };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const present = value => typeof value === 'string' && value.trim().length > 0;
  const tri = value => value === undefined || value === null || value === '' ? 'unknown' : value;
  const string = value => typeof value === 'string' ? value : '';
  const digest = value => typeof value === 'string' ? value.trim().toLowerCase() : value;

  function emptyCase() {
    const before = {}, after = {};
    FINGERPRINT_KEYS.forEach(key => { before[key] = ''; after[key] = ''; });
    return {
      schemaVersion: '1.0',
      metadata: { id: '', title: '', system: '', reviewer: '', changeSummary: '', provenance: 'user', source: '', notes: '' },
      context: { euHighRisk: 'unknown', placedOnMarket: 'unknown', priorAssessment: 'unknown', plannedChange: 'unknown', planReference: '', intendedPurposeChanged: 'unknown', complianceImpact: 'unknown', legalContextReference: '' },
      evidence: { claim: '', baselinePassed: 'unknown', evidenceReference: '', deterministic: 'unknown', dependencyCoverage: 'unknown', evaluationScopeUnchanged: 'unknown', fingerprints: { before, after } },
      change: { types: [], safeguardsChanged: 'unknown', inputPopulationChanged: 'unknown', knownRegression: 'unknown', tests: [] }
    };
  }

  function validate(input) {
    const errors = [], warnings = [];
    if (!isObject(input)) return { valid: false, errors: ['입력은 JSON 객체여야 합니다.'], warnings };
    if (input.schemaVersion !== '1.0') errors.push('schemaVersion은 "1.0"이어야 합니다.');
    ['metadata', 'context', 'evidence', 'change'].forEach(key => {
      if (input[key] !== undefined && !isObject(input[key])) errors.push(key + '는 객체여야 합니다.');
    });
    const m = isObject(input.metadata) ? input.metadata : {};
    const c = isObject(input.context) ? input.context : {};
    const e = isObject(input.evidence) ? input.evidence : {};
    const ch = isObject(input.change) ? input.change : {};
    const textFields = (obj, keys, prefix) => keys.forEach(key => {
      if (obj[key] !== undefined && typeof obj[key] !== 'string') errors.push(prefix + '.' + key + '는 문자열이어야 합니다.');
    });
    textFields(m, ['id', 'title', 'system', 'reviewer', 'changeSummary', 'provenance', 'source', 'notes'], 'metadata');
    textFields(c, ['planReference', 'legalContextReference'], 'context');
    textFields(e, ['claim', 'evidenceReference'], 'evidence');
    [[c, CONTEXT_TRI, 'context'], [e, EVIDENCE_TRI, 'evidence'], [ch, CHANGE_TRI, 'change']].forEach(([obj, keys, prefix]) => keys.forEach(key => {
      if (!TRI.includes(tri(obj[key]))) errors.push(prefix + '.' + key + '는 yes, no, unknown 중 하나여야 합니다.');
    }));
    if (m.provenance !== undefined && !['user', 'paper', 'synthetic'].includes(m.provenance)) errors.push('metadata.provenance는 user, paper, synthetic 중 하나여야 합니다.');
    if (!present(m.reviewer)) warnings.push('검토자 이름이 없습니다. 실제 승인 기록에는 담당자를 기재하세요.');
    if (m.provenance === 'synthetic') warnings.push('합성 예시입니다. 실제 실험 결과나 실제 시스템 검증으로 인용하지 마세요.');
    if (m.provenance === 'paper' && !present(m.source)) warnings.push('논문 사례의 원문 출처가 없습니다.');
    if (ch.types !== undefined && (!Array.isArray(ch.types) || ch.types.some(value => !TYPES.includes(value)))) errors.push('change.types는 허용된 변경 유형의 배열이어야 합니다.');
    if (e.fingerprints !== undefined && !isObject(e.fingerprints)) errors.push('evidence.fingerprints는 객체여야 합니다.');
    const fps = isObject(e.fingerprints) ? e.fingerprints : {};
    ['before', 'after'].forEach(side => {
      if (fps[side] !== undefined && !isObject(fps[side])) errors.push('evidence.fingerprints.' + side + '는 객체여야 합니다.');
      const values = isObject(fps[side]) ? fps[side] : {};
      FINGERPRINT_KEYS.forEach(key => {
        const value = values[key];
        if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !HASH.test(value.trim()))) errors.push('evidence.fingerprints.' + side + '.' + key + '는 64자리 SHA-256 16진수여야 합니다.');
      });
    });
    if (ch.tests !== undefined && !Array.isArray(ch.tests)) errors.push('change.tests는 배열이어야 합니다.');
    if (Array.isArray(ch.tests)) ch.tests.forEach((test, index) => {
      const prefix = 'change.tests[' + index + ']';
      if (!isObject(test)) { errors.push(prefix + '는 객체여야 합니다.'); return; }
      if (!DOMAINS.includes(test.domain)) errors.push(prefix + '.domain이 허용된 검사 영역이 아닙니다.');
      if (!STATUSES.includes(test.status)) errors.push(prefix + '.status는 pass, fail, not_run, unknown 중 하나여야 합니다.');
      textFields(test, ['reference', 'note'], prefix);
      if ((test.status === 'pass' || test.status === 'fail') && !present(test.reference)) warnings.push(prefix + ': 검사 결과의 근거 참조가 없습니다.');
    });
    return { valid: errors.length === 0, errors, warnings };
  }

  function normalize(input) {
    const result = emptyCase();
    if (!isObject(input)) return result;
    result.schemaVersion = input.schemaVersion;
    const groups = ['metadata', 'context', 'evidence', 'change'];
    groups.forEach(group => {
      if (!isObject(input[group])) return;
      Object.keys(result[group]).forEach(key => {
        if (key === 'fingerprints' || key === 'tests' || key === 'types') return;
        if (input[group][key] !== undefined) result[group][key] = input[group][key];
      });
    });
    [[result.context, CONTEXT_TRI], [result.evidence, EVIDENCE_TRI], [result.change, CHANGE_TRI]].forEach(([obj, keys]) => keys.forEach(key => { obj[key] = tri(obj[key]); }));
    const fps = isObject(input.evidence) && isObject(input.evidence.fingerprints) ? input.evidence.fingerprints : {};
    ['before', 'after'].forEach(side => FINGERPRINT_KEYS.forEach(key => {
      const value = isObject(fps[side]) ? fps[side][key] : undefined;
      result.evidence.fingerprints[side][key] = value === undefined || value === null ? '' : digest(value);
    }));
    const change = isObject(input.change) ? input.change : {};
    result.change.types = Array.isArray(change.types) ? change.types.slice() : [];
    result.change.tests = Array.isArray(change.tests) ? change.tests.map(test => isObject(test) ? { domain: test.domain, status: test.status, reference: string(test.reference), note: string(test.note) } : { domain: '', status: 'unknown', reference: '', note: '' }) : [];
    // A detached snapshot: callers may continue editing their original input.
    return JSON.parse(JSON.stringify(result));
  }

  function assess(input, options) {
    const validation = validate(input), snapshot = normalize(input);
    const now = options && options.now !== undefined ? new Date(options.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new TypeError('now는 유효한 ISO 날짜여야 합니다.');
    const c = snapshot.context, e = snapshot.evidence, ch = snapshot.change;
    const trace = [], reasons = [], missing = [], actions = [];
    const record = (id, axis, outcome, detail) => { trace.push({ id, axis, outcome, detail }); };
    const reason = (id, message) => { reasons.push({ id, message }); };
    const comparisons = FINGERPRINT_KEYS.map(key => {
      const a = e.fingerprints.before[key], b = e.fingerprints.after[key];
      const invalid = (a !== '' && (typeof a !== 'string' || !HASH.test(a))) || (b !== '' && (typeof b !== 'string' || !HASH.test(b)));
      return { key, status: invalid ? 'invalid' : !a || !b ? 'missing' : a === b ? 'same' : 'different' };
    });
    comparisons.forEach(item => {
      record('T-HASH-' + item.key.toUpperCase(), 'technical', item.status, item.key + ' 지문 비교: ' + item.status);
      if (item.status === 'missing') missing.push(item.key + '의 변경 전·후 SHA-256 지문');
    });
    [[e, EVIDENCE_TRI, 'evidence'], [ch, CHANGE_TRI, 'change'], [c, ['intendedPurposeChanged'], 'context']].forEach(([obj, keys, prefix]) => keys.forEach(key => {
      if (obj[key] === 'unknown') missing.push(prefix + '.' + key + ' 확인');
    }));
    if (!present(e.claim)) missing.push('재사용하려는 평가 주장(evidence.claim)');
    if (!present(e.evidenceReference)) missing.push('기존 평가 근거 참조(evidence.evidenceReference)');
    if (e.baselinePassed === 'no') missing.push('통과한 기준 평가와 그 근거');
    const failed = ch.tests.filter(test => test.status === 'fail');
    const regression = ch.knownRegression === 'yes' || failed.length > 0;
    const changed = comparisons.filter(item => item.status === 'different');
    const retestTriggers = [
      ['T021', ch.safeguardsChanged === 'yes', '안전장치가 변경되어 기존 평가의 의존성을 재검증해야 합니다.'],
      ['T022', ch.inputPopulationChanged === 'yes', '입력 모집단이 변경되었습니다.'],
      ['T023', c.intendedPurposeChanged === 'yes', '사용 목적 변경으로 기존 평가 범위의 적용성을 재검토해야 합니다.'],
      ['T024', e.evaluationScopeUnchanged === 'no', '기존 평가 범위가 유지되지 않습니다.'],
      ['T025', e.deterministic === 'no', '결정적 재현 조건이 충족되지 않습니다.'],
      ['T026', e.dependencyCoverage === 'no', '평가 의존성의 완전한 포괄이 확인되지 않았습니다.']
    ];
    record('T000', 'technical', validation.valid ? 'pass' : 'triggered', '유효하지 않은 입력은 판단 보류가 최우선입니다.');
    record('T010', 'technical', regression ? 'triggered' : 'not_triggered', '알려진 회귀 또는 실패한 검사는 재사용을 차단합니다.');
    record('T011', 'technical', failed.length ? 'triggered' : 'not_triggered', '실패로 신고된 검사 ' + failed.length + '개. 개별 검사 통과만으로 재사용을 허용하지 않습니다.');
    record('T020', 'technical', changed.length ? 'triggered' : 'not_triggered', '하나 이상의 지문 차이는 평가 재실행 조건입니다.');
    retestTriggers.forEach(([id, condition, message]) => record(id, 'technical', condition ? 'triggered' : 'not_triggered', message));
    let technicalCode;
    if (!validation.valid) {
      technicalCode = 'HOLD'; reason('T000', '입력 형식 또는 값에 오류가 있어 판단을 보류합니다.');
      actions.push('표시된 입력 오류를 수정한 뒤 다시 평가하세요.');
    } else if (regression) {
      technicalCode = 'INVALIDATED';
      if (ch.knownRegression === 'yes') reason('T010', '변경 후 알려진 회귀가 신고되어 현재 재사용 주장을 유지할 수 없습니다.');
      failed.forEach(test => reason('T011', test.domain + ' 검사 실패가 신고되었습니다. 관련 기존 근거를 재사용하지 마세요.'));
      actions.push('실패·회귀의 영향 범위와 원인을 조사하고 관련 평가 근거를 갱신하세요.', '수정 또는 복구 후 해당 주장에 필요한 검사를 다시 실행하세요.');
    } else if (changed.length || retestTriggers.some(item => item[1])) {
      technicalCode = 'RETEST_REQUIRED';
      if (changed.length) reason('T020', '평가 지문이 달라졌습니다: ' + changed.map(item => item.key).join(', ') + '.');
      retestTriggers.filter(item => item[1]).forEach(([id, condition, message]) => reason(id, message));
      actions.push('변경된 의존성이 영향을 주는 보안·품질·공정성·개인정보·감독 평가를 식별하고 필요한 검사를 다시 실행하세요.', '새 결과와 평가 범위, 담당자 및 의존성 명세를 기록하세요.');
    } else if (missing.length || e.baselinePassed !== 'yes') {
      technicalCode = 'HOLD'; reason('T030', '재사용에 필요한 확인 또는 근거가 부족합니다. 정보 부재는 동일성이나 안전성을 뜻하지 않습니다.');
      actions.push('부족한 근거와 unknown 항목을 확인하고 기록하세요.');
    } else {
      technicalCode = 'REUSE_SCOPED'; reason('T040', '제공된 선언상 6개 평가 지문과 결정적 평가 조건이 같고, 알려진 회귀·범위·안전장치·입력 모집단·목적 변경이 없습니다.');
      actions.push('명시된 고정 평가 주장과 범위에 한해서만 기존 결과를 인용하세요.', '의존성 명세의 완전성, 파일과 지문 연결, 검토자 승인 및 변경 기록을 보관하세요.');
    }
    record('T030', 'technical', missing.length ? 'triggered' : 'not_triggered', missing.length ? '누락·미확인 항목 ' + missing.length + '개. 상위 규칙의 결과가 우선합니다.' : '필수 근거 누락이 없습니다.');
    record('T040', 'technical', technicalCode === 'REUSE_SCOPED' ? 'selected' : 'not_selected', '모든 재사용 조건이 충족된 경우에만 제한적 재사용을 선택합니다.');
    record('T099', 'technical', technicalCode, '우선순위: 입력 오류 > 실패·회귀 > 변경·불충족 조건 > 근거 부족 > 범위 내 재사용.');
    if (missing.length && technicalCode !== 'HOLD') actions.push('결정과 별개로 표시된 미확인 항목과 누락 근거도 보완하세요.');

    const regReasons = [], regActions = [], rr = (id, message) => regReasons.push({ id, message });
    let regulatoryCode;
    if (!validation.valid) {
      regulatoryCode = 'CONTEXT_REQUIRED'; rr('R000', '입력 오류를 수정해야 규제 검토 경로를 분류할 수 있습니다.');
    } else if (c.intendedPurposeChanged === 'yes' || c.complianceImpact === 'yes') {
      regulatoryCode = 'REVIEW_REQUIRED'; rr('R010', '사용 목적 또는 요구사항 준수에 대한 영향이 신고되었습니다. 중대한 변경 해당 여부를 담당자가 검토해야 합니다.');
    } else if (c.euHighRisk === 'yes' && technicalCode === 'INVALIDATED') {
      regulatoryCode = 'REVIEW_REQUIRED'; rr('R011', '고위험 AI로 신고된 시스템에서 평가 실패·회귀가 확인되어 요구사항 준수 영향 검토가 필요합니다.');
      if (c.complianceImpact === 'no') validation.warnings.push('고위험 AI의 검사 실패·회귀와 complianceImpact=no가 함께 신고되었습니다. 범위와 근거를 검토하세요.');
    } else if (c.euHighRisk === 'no' && c.placedOnMarket !== 'no' && (c.intendedPurposeChanged === 'unknown' || c.complianceImpact === 'unknown')) {
      regulatoryCode = 'CONTEXT_REQUIRED'; rr('R021', '현재 비고위험으로 신고되었어도 사용 목적 또는 준수 영향이 미확인입니다. 변경 후 적용 분류와 영향을 먼저 확인해야 합니다.');
      regActions.push('변경 전·후 사용 목적과 고위험 해당 여부, 요구사항 준수 영향을 확인하세요.');
    } else if (c.euHighRisk === 'no' || c.placedOnMarket === 'no') {
      regulatoryCode = 'OUT_OF_SCOPE'; rr('R020', c.euHighRisk === 'no' ? '고위험 AI가 아니라고 신고되어, 이미 평가된 고위험 AI의 제43조(4) 경로에는 해당하지 않습니다.' : '아직 시장 출시·서비스 개시 전으로 신고되어, 이미 평가된 시스템의 변경에 관한 제43조(4) 경로에는 해당하지 않습니다.');
      regActions.push('다른 AI Act 의무, 최초 적합성 평가 및 기타 적용 법령은 별도로 확인하세요.');
    } else if (c.euHighRisk !== 'yes' || c.placedOnMarket !== 'yes' || c.priorAssessment !== 'yes') {
      regulatoryCode = 'CONTEXT_REQUIRED'; rr('R030', '고위험 해당 여부, 시장 출시·서비스 개시 여부, 기존 적합성 평가 여부를 확인해야 합니다.');
      regActions.push('적용 분류, 시스템 역할, 최초 평가 문서와 적용 시점·법적 맥락을 확인하세요.');
    } else if (c.plannedChange !== 'yes' || !present(c.planReference)) {
      regulatoryCode = 'REVIEW_REQUIRED'; rr('R040', '이미 평가된 고위험 AI의 변경이 최초 평가에서 예정되었는지 확인되지 않거나 계획 근거가 없습니다.');
      regActions.push('최초 적합성 평가와 기술 문서에 포함된 변경 계획 및 허용 범위를 비교하세요.');
    } else if (c.intendedPurposeChanged === 'unknown' || c.complianceImpact === 'unknown' || !present(c.legalContextReference)) {
      regulatoryCode = 'CONTEXT_REQUIRED'; rr('R050', '변경 계획이 있어도 목적·준수 영향과 적용 법적 맥락의 근거가 완성되어야 합니다.');
      regActions.push('사용 목적과 준수 영향의 근거 및 legalContextReference를 보완하세요.');
    } else {
      regulatoryCode = 'DOCUMENTED_PATH'; rr('R060', '계획 참조와 법적 맥락이 제공되고 목적·준수 영향 없음이 신고되었습니다. 담당자가 문서화된 계획의 범위와 조건을 확인할 수 있습니다.');
      regActions.push('계획된 변경의 예외는 지속적으로 학습하는 시스템에 관한 구체적 조건을 포함합니다. 계획 문서만으로 면제를 인정하지 마세요.');
    }
    regActions.push('이 출력은 중대한 변경 여부나 새 적합성 평가 의무의 최종 판단이 아닙니다. 책임 있는 담당자가 적용 법령·시점과 증거를 확인하고 결정을 기록하세요.');
    regReasons.forEach(item => record(item.id, 'regulatory', regulatoryCode, item.message));
    record('R099', 'regulatory', regulatoryCode, '목적·준수 영향 및 고위험 실패 우선, 이후 적용 범위·기존 평가·변경 계획·근거 순으로 검토합니다.');
    return {
      schemaVersion: '1.0', ruleVersion: VERSION, assessedAt: now.toISOString(), input: snapshot,
      technical: { code: technicalCode, label: LABELS[technicalCode], reasons, missing, actions, comparisons },
      regulatory: { code: regulatoryCode, label: LABELS[regulatoryCode], reasons: regReasons, actions: regActions },
      trace,
      limitations: [
        '연구용 의사결정 지원 도구이며 안전 인증, 법률 자문 또는 자동 적합성 평가 도구가 아닙니다.',
        '지문과 체크리스트 값은 사용자가 제공한 주장입니다. 엔진은 파일, 의존성 명세의 완전성, 시험 결과 또는 실제 운영 안전성을 독립적으로 검증하지 않습니다.',
        '동일 지문은 선언된 바이트의 동일성만 지원합니다. 평가 매니페스트가 모든 관련 의존성과 변경을 포괄하는지는 별도의 검토가 필요합니다.',
        'REUSE_SCOPED는 명시된 고정 평가 결과의 제한적 재사용만 뜻하며 적합성 평가의 법적 유효성이나 운영 중 안전성을 보장하지 않습니다.',
        '규제 연결은 Regulation (EU) 2024/1689의 2024년 제정문 제3조(23), 제43조(4), 부속서 IV 2(f)에 대한 개념적 대응입니다. 최신 개정·시행 일정·해석을 유지 관리하는 법률 규칙이 아닙니다.',
        '계획된 변경이라는 사실만으로 중대한 변경에서 제외되지 않습니다. 제43조(4)의 사전 예정 변경 규정은 지속적으로 학습하는 시스템과 기술 문서 조건을 구체적으로 다룹니다.',
        '검사 항목의 단독 pass는 재사용 판정의 충분조건이 아닙니다. 이 구현의 동작 테스트는 거버넌스 프레임워크의 효과성 검증이 아닙니다.'
      ], validation
    };
  }

  function toMarkdown(result) {
    if (!result || !result.technical || !result.regulatory || !result.input) throw new TypeError('assess 결과가 필요합니다.');
    // Escape all user-controlled prose and encode the complete snapshot inside a
    // fence longer than every run of backticks in that snapshot.
    const esc = value => String(value === undefined || value === null ? '' : value).replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&').replace(/\r?\n/g, '  \n');
    const m = result.input.metadata;
    const lines = ['# 전처리 변경 검토 보고서', '',
      '- 사례: ' + esc(m.title || m.id || '제목 없음'),
      '- 사례 ID: ' + esc(m.id), '- 시스템: ' + esc(m.system), '- 검토자: ' + esc(m.reviewer || '미기재'),
      '- 출처 구분: ' + esc(m.provenance), '- 원문·사례 출처: ' + esc(m.source || '미기재'),
      '- 평가 시각: ' + esc(result.assessedAt), '- 규칙 버전: ' + esc(result.ruleVersion),
      '', '## 변경 요약', '', esc(m.changeSummary || '미기재'), '', '## 기술적 근거 재사용', '',
      '**' + result.technical.code + ' — ' + esc(result.technical.label) + '**', ''];
    result.technical.reasons.forEach(item => lines.push('- ' + item.id + ': ' + esc(item.message)));
    lines.push('', '### 평가 지문', '', '| 항목 | 비교 |', '| --- | --- |');
    result.technical.comparisons.forEach(item => lines.push('| ' + item.key + ' | ' + item.status + ' |'));
    lines.push('', '### 부족한 근거', '');
    if (!result.technical.missing.length) lines.push('명시된 재사용 조건의 누락 항목이 없습니다. 독립적인 검증을 의미하지 않습니다.');
    else result.technical.missing.forEach(item => lines.push('- ' + esc(item)));
    lines.push('', '### 후속 조치', '');
    result.technical.actions.forEach(item => lines.push('- ' + esc(item)));
    lines.push('', '## 별도 규제 검토', '', '**' + result.regulatory.code + ' — ' + esc(result.regulatory.label) + '**', '');
    result.regulatory.reasons.forEach(item => lines.push('- ' + item.id + ': ' + esc(item.message)));
    result.regulatory.actions.forEach(item => lines.push('- ' + esc(item)));
    lines.push('', '## 입력 검증', '', '- 입력 형식: ' + (result.validation.valid ? '유효' : '오류 있음'));
    result.validation.errors.forEach(item => lines.push('- 오류: ' + esc(item)));
    result.validation.warnings.forEach(item => lines.push('- 주의: ' + esc(item)));
    lines.push('', '## 규칙 추적', '');
    result.trace.forEach(item => lines.push('- ' + item.id + ' / ' + item.axis + ' / ' + item.outcome + ': ' + esc(item.detail)));
    lines.push('', '## 한계 및 적용 범위', '');
    result.limitations.forEach(item => lines.push('- ' + esc(item)));
    lines.push('', '## 공식 제정문 출처', '', '[Regulation (EU) 2024/1689 — EUR-Lex, 2024년 제정문](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)', '', '## 평가 당시 입력 스냅샷', '');
    const json = JSON.stringify(result.input, null, 2);
    const runs = json.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
    lines.push(fence + 'json', json, fence, '');
    return lines.join('\n');
  }

  return { VERSION, FINGERPRINT_KEYS, assess, validate, emptyCase, toMarkdown };
}));
