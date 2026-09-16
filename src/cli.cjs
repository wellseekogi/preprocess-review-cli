'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const engine = require('./engine.cjs');
const VERSION = require('../package.json').version;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const COMMANDS = ['check', 'assess', 'batch', 'template', 'init', 'fingerprint'];
const versionText = () => `preprocess-review ${VERSION} (ruleVersion ${engine.VERSION})\n`;

function usage(command) {
  const header = versionText() + '\n전처리 변경의 평가 근거 재사용 및 별도 규제 검토를 지원하는 오프라인 연구 도구입니다.\n';
  const check = `사용법:\n  preprocess-review ${command === 'assess' ? 'assess' : 'check'} <case.json> [--format text|json|md] [--out report] [--force] [--strict]\n\n기본 출력은 한국어 텍스트이며 기술 판단과 규제 검토를 별도로 표시합니다.\ncheck와 assess는 같은 명령입니다.\n`;
  const batch = '사용법:\n  preprocess-review batch <cases.json> [--format text|json|csv] [--out report] [--force] [--strict]\n\n입력은 사례 객체가 하나 이상 있는 JSON 배열입니다. 기본 출력은 한국어 텍스트입니다.\n';
  const template = `사용법:\n  preprocess-review ${command === 'init' ? 'init' : 'template'} [--out case.json] [--force]\n\n미확인 값을 unknown으로 둔 JSON 입력 양식을 생성합니다. template과 init은 같은 명령입니다.\n`;
  const fingerprint = '사용법:\n  preprocess-review fingerprint <file> [file ...]\n\n실제 로컬 파일 바이트의 SHA-256과 크기를 JSON으로 출력합니다.\n의존성 명세의 완전성이나 평가 주장을 검증하지 않습니다.\n대시로 시작하는 파일명은 -- 뒤에 지정하세요. 파일을 업로드하지 않습니다.\n';
  const all = '사용법:\n  preprocess-review check <case.json> [--format text|json|md] [--out report] [--force] [--strict]\n  preprocess-review assess <case.json> [동일 옵션]\n  preprocess-review batch <cases.json> [--format text|json|csv] [--out report] [--force] [--strict]\n  preprocess-review template [--out case.json] [--force]\n  preprocess-review init [--out case.json] [--force]\n  preprocess-review fingerprint <file> [file ...]\n  preprocess-review <command> --help\n';
  const body = ['check', 'assess'].includes(command) ? check : command === 'batch' ? batch : ['template', 'init'].includes(command) ? template : command === 'fingerprint' ? fingerprint : all;
  return header + '\n' + body + '\n공통 옵션: --help, -h 도움말 / --version, -v 버전\n' +
    '기존 --out 파일은 --force 없이는 덮어쓰지 않습니다. 입력 파일은 덮어쓰지 않습니다.\n' +
    '입력 JSON 한도: 2 MB. UTF-8 BOM 허용. 추가 패키지 의존성·네트워크 호출 없음. Node.js 22 이상 필요.\n\n' +
    '종료 코드: 정상 판단 0 / 입력·명령·파일 오류 1.\n' +
    '--strict(check/assess/batch): 유효한 입력 중 사람의 검토가 필요하면 2.\n' +
    'strict 0은 기술 REUSE_SCOPED 및 규제 DOCUMENTED_PATH 또는 OUT_OF_SCOPE일 때만 반환합니다.\n' +
    'strict 0도 안전 인증이나 법적 승인, 새 적합성 평가의 면제를 뜻하지 않습니다.\n';
}

function fail(message) { throw new Error(message); }
function display(value) {
  // Inputs are data. Escape terminal control bytes, including ANSI ESC, rather
  // than letting a case title manipulate the terminal or forge result lines.
  return String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}
function checkPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value)) fail(label + ': 제어 문자가 없는 비어 있지 않은 경로가 필요합니다.');
  return path.resolve(value);
}
function parseArgs(input) {
  const argv = input.slice();
  const command = argv.shift();
  if (!command || command === '--help' || command === '-h') return { command: 'help' };
  if (command === '--version' || command === '-v') return { command: 'version' };
  if (command === 'help') {
    if (argv.length > 1 || (argv[0] && !COMMANDS.includes(argv[0]))) fail('도움말을 요청할 명령이 올바르지 않습니다.');
    return { command: 'help', topic: argv[0] };
  }
  if (!COMMANDS.includes(command)) fail('알 수 없는 명령: ' + command + '. --help를 확인하세요.');
  const canonical = command === 'assess' ? 'check' : command === 'init' ? 'template' : command;
  const options = { command: canonical, invoked: command, paths: [], format: ['template', 'fingerprint'].includes(canonical) ? 'json' : 'text', force: false, strict: false };
  const seen = new Set();
  let literal = false;
  while (argv.length) {
    const value = argv.shift();
    if (value === '--' && !literal) { literal = true; continue; }
    if (!literal && ['--help', '-h'].includes(value)) return { command: 'help', topic: command };
    if (!literal && ['--version', '-v'].includes(value)) return { command: 'version' };
    if (!literal && ['--out', '--format', '--force', '--strict'].includes(value)) {
      if (canonical === 'fingerprint') fail('fingerprint는 파일 경로만 받습니다. --help를 확인하세요.');
      if (seen.has(value)) fail('중복 옵션: ' + value);
      seen.add(value);
      if (value === '--force' || value === '--strict') options[value.slice(2)] = true;
      else {
        if (!argv.length || argv[0].startsWith('-')) fail(value + ' 옵션 값이 없습니다.');
        options[value.slice(2)] = argv.shift();
      }
    } else if (!literal && value.startsWith('-')) fail('알 수 없는 옵션: ' + value);
    else options.paths.push(value);
  }
  const expected = canonical === 'template' ? 0 : canonical === 'fingerprint' ? null : 1;
  if (expected !== null && options.paths.length !== expected) fail(command + ' 명령은 입력 경로 ' + expected + '개를 받습니다.');
  if (canonical === 'fingerprint' && !options.paths.length) fail('fingerprint에는 파일 경로가 하나 이상 필요합니다.');
  const formats = canonical === 'check' ? ['text', 'json', 'md'] : canonical === 'batch' ? ['text', 'json', 'csv'] : ['json'];
  if (!formats.includes(options.format)) fail(command + '에서 지원하지 않는 출력 형식: ' + options.format);
  if (options.force && !options.out) fail('--force에는 --out이 필요합니다.');
  if (options.strict && !['check', 'batch'].includes(canonical)) fail('--strict는 check, assess, batch에서만 사용할 수 있습니다.');
  return options;
}

function readJSON(filename) {
  const resolved = checkPath(filename, '입력');
  const fd = fs.openSync(resolved, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail('입력은 일반 파일이어야 합니다.');
    if (stat.size > MAX_JSON_BYTES) fail('입력 JSON이 2 MB 한도를 초과했습니다.');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > MAX_JSON_BYTES) fail('입력 JSON이 2 MB 한도를 초과했습니다.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); }
    catch (error) { fail('유효한 UTF-8 JSON이 아닙니다: ' + error.message); }
    return { value, resolved, real: fs.realpathSync(resolved), stat };
  } finally { fs.closeSync(fd); }
}

function writeResult(content, options, inputFile, stdout) {
  if (!options.out) { stdout.write(content); return; }
  const target = checkPath(options.out, '출력');
  const parent = fs.realpathSync(path.dirname(target));
  const canonical = path.join(parent, path.basename(target));
  const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (inputFile && equal(canonical, inputFile.real)) fail('입력 파일은 --force를 사용해도 덮어쓸 수 없습니다.');
  let prior;
  try { prior = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior) {
    if (prior.isSymbolicLink() || !prior.isFile()) fail('출력은 일반 파일이어야 합니다. 심볼릭 링크와 디렉터리는 출력 대상으로 사용할 수 없습니다.');
    if (inputFile && inputFile.stat.dev === prior.dev && inputFile.stat.ino === prior.ino) fail('출력 경로가 입력 파일을 가리킵니다.');
    if (!options.force) fail('출력 파일이 이미 있습니다. 덮어쓰려면 --force를 사용하세요.');
  }
  if (!options.force) {
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  const temp = path.join(parent, '.' + path.basename(target) + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, target);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function toText(result) {
  const m = result.input.metadata;
  const lines = [
    '전처리 변경 검토',
    '사례: ' + display(m.title || m.id || '제목 없음'),
    'ID: ' + display(m.id || '미기재') + ' | 시스템: ' + display(m.system || '미기재'),
    '검토자: ' + display(m.reviewer || '미기재') + ' | 출처 구분: ' + display(m.provenance),
    '출처: ' + display(m.source || '미기재'),
    '변경 요약: ' + display(m.changeSummary || '미기재'),
    '재사용 대상 평가 주장: ' + display(result.input.evidence.claim || '미기재'),
    '기존 평가 근거 참조: ' + display(result.input.evidence.evidenceReference || '미기재'),
    '평가 시각: ' + display(result.assessedAt),
    '도구 버전: ' + VERSION + ' | 규칙 버전: ' + result.ruleVersion,
    '', '[기술 평가]', result.technical.code + ' — ' + result.technical.label
  ];
  result.technical.reasons.forEach(item => lines.push('  - ' + item.id + ': ' + display(item.message)));
  lines.push('', '부족한 근거:');
  if (result.technical.missing.length) result.technical.missing.forEach(item => lines.push('  - ' + display(item)));
  else lines.push('  - 명시된 필수 항목의 누락 없음. 독립 검증을 의미하지 않습니다.');
  lines.push('', '기술 후속 조치:');
  result.technical.actions.forEach(item => lines.push('  - ' + display(item)));
  lines.push('', '[규제 검토]', result.regulatory.code + ' — ' + result.regulatory.label);
  result.regulatory.reasons.forEach(item => lines.push('  - ' + item.id + ': ' + display(item.message)));
  lines.push('', '규제 후속 조치:');
  result.regulatory.actions.forEach(item => lines.push('  - ' + display(item)));
  if (result.validation.errors.length || result.validation.warnings.length) {
    lines.push('', '[입력 확인]');
    result.validation.errors.forEach(item => lines.push('  오류: ' + display(item)));
    result.validation.warnings.forEach(item => lines.push('  주의: ' + display(item)));
  }
  lines.push('', '이 결과는 입력된 선언에 따른 연구용 판단입니다. 지문·실험·의존성을 독립 검증하지 않습니다.', '안전 인증이나 법적 승인이 아닙니다. 전체 규칙 추적·입력 스냅샷은 --format json으로 확인하세요. 개별 check는 md도 지원합니다.', '');
  return lines.join('\n');
}

function csvCell(value) {
  let text = String(value === undefined || value === null ? '' : value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function toCSV(results) {
  const rows = [['id', 'title', 'provenance', 'technical_code', 'technical_label', 'regulatory_code', 'regulatory_label', 'valid', 'missing', 'errors', 'warnings', 'tool_version', 'rule_version', 'assessed_at']];
  results.forEach(result => rows.push([
    result.input.metadata.id, result.input.metadata.title, result.input.metadata.provenance,
    result.technical.code, result.technical.label, result.regulatory.code, result.regulatory.label,
    result.validation.valid, result.technical.missing.join('; '), result.validation.errors.join('; '), result.validation.warnings.join('; '), VERSION, result.ruleVersion, result.assessedAt
  ]));
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function fingerprint(filename) {
  const resolved = checkPath(filename, '지문 입력');
  const fd = fs.openSync(resolved, 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) fail('지문 입력은 일반 파일이어야 합니다: ' + filename);
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let total = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count)); total += count;
    }
    const after = fs.fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || total !== before.size) fail('해싱 도중 파일이 변경되었습니다. 변경이 없는 복사본으로 다시 시도하세요: ' + filename);
    return { path: resolved, bytes: total, algorithm: 'SHA-256', sha256: hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function needsAttention(result) {
  return result.technical.code !== 'REUSE_SCOPED' || !['DOCUMENTED_PATH', 'OUT_OF_SCOPE'].includes(result.regulatory.code);
}
function run(argv, stdout, stderr) {
  const options = parseArgs(argv);
  if (options.command === 'help') { stdout.write(usage(options.topic)); return 0; }
  if (options.command === 'version') { stdout.write(versionText()); return 0; }
  if (options.command === 'template') { writeResult(JSON.stringify(engine.emptyCase(), null, 2) + '\n', options, null, stdout); return 0; }
  if (options.command === 'fingerprint') {
    const files = options.paths.map(fingerprint);
    stdout.write(JSON.stringify({ algorithm: 'SHA-256', scope: 'File bytes only; does not verify evaluation dependencies or claims.', files }, null, 2) + '\n');
    return 0;
  }
  const inputFile = readJSON(options.paths[0]);
  let results;
  if (options.command === 'batch') {
    if (!Array.isArray(inputFile.value) || inputFile.value.length === 0) fail('batch 입력은 사례가 하나 이상 있는 JSON 배열이어야 합니다.');
    results = inputFile.value.map(value => Object.assign({ toolVersion: VERSION }, engine.assess(value)));
  } else results = [Object.assign({ toolVersion: VERSION }, engine.assess(inputFile.value))];
  let output;
  if (options.command === 'check') {
    output = options.format === 'md' ? engine.toMarkdown(results[0]).replace(/^(# [^\n]+)\n/, '$1\n\n- CLI 도구 버전: ' + VERSION + '\n') : options.format === 'json' ? JSON.stringify(results[0], null, 2) + '\n' : toText(results[0]);
  } else {
    output = options.format === 'csv' ? toCSV(results) : options.format === 'json' ? JSON.stringify(results, null, 2) + '\n' : '일괄 검토: ' + results.length + '개 사례\n\n' + results.map((result, index) => '=== ' + (index + 1) + ' / ' + results.length + ' ===\n' + toText(result)).join('\n');
  }
  writeResult(output, options, inputFile, stdout);
  if (results.some(result => !result.validation.valid)) {
    stderr.write('입력 스키마 오류가 있습니다. 보고서의 입력 확인 또는 validation.errors를 확인하세요.\n');
    return 1;
  }
  if (options.strict && results.some(needsAttention)) return 2;
  return 0;
}

function main(argv = process.argv.slice(2), streams = {}) {
  const stdout = streams.stdout || process.stdout, stderr = streams.stderr || process.stderr;
  try { return run(argv, stdout, stderr); }
  catch (error) { stderr.write('오류: ' + display(error.message) + '\n'); return 1; }
}

module.exports = { VERSION, main, parseArgs, toText, toCSV, fingerprint, needsAttention };
