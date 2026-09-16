'use strict';

// Public command contract tests. These assertions invoke the actual executable
// and do not import its parser, renderer, or decision implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'preprocess-review.cjs');
const EXAMPLES = path.join(ROOT, 'examples');
const SCRATCH = fs.mkdtempSync(path.join(__dirname, '.cli-interface-'));
const fixture = (name) => path.join(EXAMPLES, name + '.json');
let serial = 0;

function run(args, cwd = ROOT) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'CLI must exit normally: ' + result.stderr);
  return result;
}

function tempFile(name, value) {
  const target = path.join(SCRATCH, String(++serial) + '-' + name);
  if (value !== undefined) fs.writeFileSync(target, value);
  return target;
}

function parsed(result, status = 0) {
  assert.equal(result.status, status, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b\[/, 'machine output must not contain ANSI escapes');
  return JSON.parse(result.stdout);
}

function withoutTimestamp(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.assessedAt;
  return copy;
}

test.after(() => {
  // Resolve and check the one generated directory before recursive cleanup.
  const target = fs.realpathSync(SCRATCH);
  const testDirectory = fs.realpathSync(__dirname);
  assert.equal(path.dirname(target), testDirectory);
  assert.ok(path.basename(target).startsWith('.cli-interface-'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('global help and version describe the CLI package', () => {
  for (const args of [[], ['--help'], ['-h'], ['help']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /check/);
    assert.match(result.stdout, /batch/);
    assert.match(result.stdout, /fingerprint/);
    assert.equal(result.stderr, '');
  }
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.ok(version.stdout.includes(require('../package.json').version));
  assert.equal(version.stderr, '');
});

test('each documented command exposes help without requiring input', () => {
  for (const command of ['check', 'assess', 'batch', 'template', 'init', 'fingerprint']) {
    const result = run([command, '--help']);
    assert.equal(result.status, 0, command + ': ' + result.stderr);
    assert.match(result.stdout, new RegExp(command));
    assert.ok(result.stdout.trim().length > 30, command + ' must have useful help');
    assert.equal(result.stderr, '');
  }
});

test('check defaults to readable text with independent technical and regulatory axes', () => {
  const result = run(['check', fixture('paper-mask-removal')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[기술 평가\]/);
  assert.match(result.stdout, /\[규제 검토\]/);
  assert.match(result.stdout, /INVALIDATED/);
  assert.match(result.stdout, /OUT_OF_SCOPE/);
  assert.doesNotMatch(result.stdout.trimStart(), /^[{[]/);
  assert.equal(result.stderr, '');
});

test('assess is a check alias and preserves machine-readable results', () => {
  const check = parsed(run(['check', fixture('synthetic-exact-reuse'), '--format', 'json']));
  const assess = parsed(run(['assess', fixture('synthetic-exact-reuse'), '--format', 'json']));
  assert.deepEqual(withoutTimestamp(check), withoutTimestamp(assess));
  assert.equal(check.technical.code, 'REUSE_SCOPED');
  assert.equal(check.regulatory.code, 'DOCUMENTED_PATH');
  assert.equal(check.validation.valid, true);
  const text = run(['assess', fixture('synthetic-exact-reuse')]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /\[기술 평가\]/);
  assert.match(text.stdout, /\[규제 검토\]/);
});

test('JSON check stdout is a clean report and Markdown is separately selectable', () => {
  const result = run(['check', fixture('paper-mask-removal'), '--format', 'json']);
  const report = parsed(result);
  assert.equal(report.technical.code, 'INVALIDATED');
  assert.equal(report.input.metadata.id, 'paper-mask-removal');
  assert.ok(Array.isArray(report.trace));
  assert.ok(report.trace.length > 0);
  assert.equal(result.stderr, '');
  const markdown = run(['check', fixture('paper-mask-removal'), '--format', 'md']);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /^#/);
  assert.match(markdown.stdout, /INVALIDATED/);
  assert.match(markdown.stdout, /OUT_OF_SCOPE/);
});

test('template and init emit a reusable JSON input with unknown defaults', () => {
  const template = parsed(run(['template']));
  const initial = parsed(run(['init']));
  assert.deepEqual(initial, template);
  assert.equal(initial.schemaVersion, '1.0');
  assert.equal(initial.context.euHighRisk, 'unknown');
  assert.equal(initial.context.intendedPurposeChanged, 'unknown');
  assert.equal(initial.evidence.baselinePassed, 'unknown');
  assert.equal(initial.change.knownRegression, 'unknown');
  assert.ok(Array.isArray(initial.change.tests));
  const target = tempFile('새 검토.json');
  const saved = run(['init', '--out', target]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), initial);
  const report = parsed(run(['check', target, '--format', 'json']));
  assert.equal(report.technical.code, 'HOLD');
});

test('batch supports default text, JSON reports, and CSV rows', () => {
  const cases = fixture('cases');
  const expectedCount = JSON.parse(fs.readFileSync(cases, 'utf8')).length;
  const text = run(['batch', cases]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /paper-mask-removal/);
  assert.match(text.stdout, /synthetic-exact-reuse/);
  assert.match(text.stdout, /INVALIDATED/);
  assert.match(text.stdout, /REUSE_SCOPED/);
  const reports = parsed(run(['batch', cases, '--format', 'json']));
  assert.equal(reports.length, expectedCount);
  assert.equal(reports[0].input.metadata.id, 'paper-mask-removal');
  const csv = run(['batch', cases, '--format', 'csv']);
  assert.equal(csv.status, 0, csv.stderr);
  assert.match(csv.stdout, /technical_code/);
  assert.match(csv.stdout, /regulatory_code/);
  assert.match(csv.stdout, /"paper-mask-removal"/);
  assert.match(csv.stdout, /"REUSE_SCOPED"/);
  assert.equal(csv.stderr, '');
});

test('strict mode signals attention with status 2 while keeping a full report', () => {
  for (const name of ['paper-mask-removal', 'synthetic-missing-evidence']) {
    const ordinary = run(['check', fixture(name), '--format', 'json']);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    const strict = parsed(run(['check', fixture(name), '--strict', '--format', 'json']), 2);
    assert.equal(strict.validation.valid, true);
    assert.notEqual(strict.technical.code, 'REUSE_SCOPED');
  }
  const reuse = parsed(run(['check', fixture('synthetic-exact-reuse'), '--strict', '--format', 'json']));
  assert.equal(reuse.technical.code, 'REUSE_SCOPED');
  assert.equal(reuse.regulatory.code, 'DOCUMENTED_PATH');
  const alias = run(['assess', fixture('paper-mask-removal'), '--strict']);
  assert.equal(alias.status, 2, alias.stderr);
  assert.match(alias.stdout, /INVALIDATED/);
});

test('strict batch combines attention outcomes and accepts all-reuse batches', () => {
  const reports = parsed(run(['batch', fixture('cases'), '--strict', '--format', 'json']), 2);
  assert.ok(reports.some(report => report.technical.code === 'INVALIDATED'));
  const reuse = JSON.parse(fs.readFileSync(fixture('synthetic-exact-reuse'), 'utf8'));
  const target = tempFile('reuse-batch.json', JSON.stringify([reuse]));
  const clean = parsed(run(['batch', target, '--strict', '--format', 'json']));
  assert.equal(clean.length, 1);
  assert.equal(clean[0].technical.code, 'REUSE_SCOPED');
});

test('strict still writes an attention report to the requested output file', () => {
  const target = tempFile('attention-report.json');
  const result = run(['check', fixture('paper-mask-removal'), '--strict', '--format', 'json', '--out', target]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).technical.code, 'INVALIDATED');
  assert.equal(result.stdout, '');
});

test('malformed JSON and invalid schema are execution errors, never strict attention', () => {
  const malformed = tempFile('malformed.json', '{broken');
  const parseError = run(['check', malformed, '--strict']);
  assert.equal(parseError.status, 1);
  assert.ok(parseError.stderr.trim());
  const invalid = JSON.parse(fs.readFileSync(fixture('synthetic-exact-reuse'), 'utf8'));
  invalid.context.euHighRisk = 'sometimes';
  const invalidPath = tempFile('invalid-schema.json', JSON.stringify(invalid));
  const schemaResult = run(['check', invalidPath, '--strict', '--format', 'json']);
  assert.equal(schemaResult.status, 1, schemaResult.stderr);
  const report = JSON.parse(schemaResult.stdout);
  assert.equal(report.validation.valid, false);
  assert.ok(report.validation.errors.length > 0);
  assert.notEqual(report.technical.code, 'REUSE_SCOPED');
});

test('bad command arguments and empty batches consistently fail with status 1', () => {
  const emptyBatch = tempFile('empty-batch.json', '[]');
  const failures = [
    ['nonexistent-command'], ['check'], ['check', fixture('paper-mask-removal'), '--format', 'csv'],
    ['check', fixture('paper-mask-removal'), '--unknown-flag'],
    ['check', fixture('paper-mask-removal'), '--out'],
    ['check', fixture('paper-mask-removal'), '--force'],
    ['template', '--strict'], ['fingerprint'], ['batch', emptyBatch],
    ['check', path.join(SCRATCH, 'missing.json')]
  ];
  for (const args of failures) {
    const result = run(args);
    assert.equal(result.status, 1, args.join(' ') + '\n' + result.stderr);
    assert.ok(result.stderr.trim(), 'errors must be explained on stderr');
  }
});

test('output creation is explicit and refuses accidental replacement', () => {
  const target = tempFile('existing-report.json', 'keep this existing file');
  const args = ['check', fixture('synthetic-exact-reuse'), '--format', 'json', '--out', target];
  const denied = run(args);
  assert.equal(denied.status, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep this existing file');
  const forced = run([...args, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).technical.code, 'REUSE_SCOPED');
  assert.equal(forced.stdout, '');
});

test('even force never overwrites the input case with its report', () => {
  const original = fs.readFileSync(fixture('paper-mask-removal'));
  const inputPath = tempFile('protected-input.json', original);
  const result = run(['check', inputPath, '--format', 'json', '--out', inputPath, '--force']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(inputPath), original);
});

test('fingerprint reports actual file bytes with the expected SHA-256', () => {
  const bytes = Buffer.from([0, 1, 2, 10, 13, 127, 128, 255]);
  const first = tempFile('원시 바이트.bin', bytes);
  const second = tempFile('zero-byte.bin', Buffer.alloc(0));
  const report = parsed(run(['fingerprint', first, second]));
  assert.equal(report.algorithm, 'SHA-256');
  assert.equal(report.files.length, 2);
  assert.equal(report.files[0].path, first);
  assert.equal(report.files[0].bytes, bytes.length);
  assert.equal(report.files[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.files[1].bytes, 0);
  assert.equal(report.files[1].sha256, crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  assert.ok(report.scope, 'the file-only scope must be disclosed');
});

test('literal argument delimiter allows a file whose name begins with a dash', () => {
  const target = path.join(SCRATCH, '-h');
  fs.writeFileSync(target, 'literal file content');
  const report = parsed(run(['fingerprint', '--', '-h'], SCRATCH));
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].path, target);
  assert.equal(report.files[0].sha256, crypto.createHash('sha256').update('literal file content').digest('hex'));
});

test('human output escapes terminal controls without mutating the JSON evidence', () => {
  const input = JSON.parse(fs.readFileSync(fixture('synthetic-exact-reuse'), 'utf8'));
  const hostileTitle = 'USER \u001b[31mred\u001b[0m \u0007 \u009b2J \u202econtrol';
  input.metadata.title = hostileTitle;
  const target = tempFile('terminal-controls.json', JSON.stringify(input));
  const text = run(['check', target]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /USER/);
  assert.doesNotMatch(text.stdout, /[\u0007\u001b\u009b\u202e]/);
  const machine = parsed(run(['check', target, '--format', 'json']));
  assert.equal(machine.input.metadata.title, hostileTitle);
  const batch = tempFile('terminal-controls-batch.json', JSON.stringify([input]));
  const batchText = run(['batch', batch]);
  assert.equal(batchText.status, 0, batchText.stderr);
  assert.doesNotMatch(batchText.stdout, /[\u0007\u001b\u009b\u202e]/);
});

test('UTF-8 BOM is accepted and invalid UTF-8 is not silently replaced', () => {
  const input = JSON.parse(fs.readFileSync(fixture('synthetic-exact-reuse'), 'utf8'));
  const bom = tempFile('bom-input.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(input))]));
  assert.equal(parsed(run(['check', bom, '--format', 'json'])).technical.code, 'REUSE_SCOPED');
  input.metadata.title = 'UTF8_PROBE';
  const parts = JSON.stringify(input).split('UTF8_PROBE');
  assert.equal(parts.length, 2);
  const malformed = tempFile('invalid-utf8.json', Buffer.concat([Buffer.from(parts[0]), Buffer.from([0xff]), Buffer.from(parts[1])]));
  const result = run(['check', malformed, '--format', 'json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
});