'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, validate, wilson95, MetricsValidationError } = require('../src/scan-metrics.cjs');

function fixture(n = 100, samplingAssumption = 'iid') {
  return {
    schemaVersion: 1, provenance: 'synthetic', samplingAssumption,
    clean: Array.from({ length: n }, (_, index) => ({ id: 'c' + index, label: 'cat', baseline: 'cat', candidate: 'cat' })),
    attacks: Array.from({ length: n }, (_, index) => ({ id: 'a' + index, cleanId: 'c' + index, target: 'dog', baseline: 'cat', candidate: 'cat' }))
  };
}
function close(actual, expected, tolerance = 1e-10) { assert.ok(Math.abs(actual - expected) < tolerance, actual + ' != ' + expected); }

test('Wilson 0/100 and 100/100 have expected non-degenerate limits', () => {
  const zero = wilson95(0, 100), full = wilson95(100, 100);
  assert.equal(zero.lower, 0); close(zero.upper, 0.03699349820698568);
  close(full.lower, 1 - zero.upper); assert.equal(full.upper, 1);
  assert.equal(zero.confidenceLevel, 0.95);
});
test('Wilson central and tiny samples stay bounded', () => {
  const mid = wilson95(50, 100);
  close(mid.lower, 0.4038315303659956); close(mid.upper, 0.5961684696340044);
  close(wilson95(0, 1).upper, 0.7934506856227626);
  assert.equal(wilson95(0, 0), null);
  for (const pair of [[-1, 2], [3, 2], [0.5, 2], [0, -1], [NaN, 2], [0, Infinity]]) assert.throws(() => wilson95(...pair), RangeError);
});
test('adequate zero-signal synthetic data has scoped LOW and visible provenance', () => {
  const result = analyze(fixture());
  assert.equal(result.risk.level, 'LOW_WITHIN_TESTED_SCOPE');
  assert.equal(result.provenance, 'synthetic'); assert.equal(result.sufficiency.sufficient, true);
  assert.equal(result.metrics.attackSuccessCandidate.denominator, 100);
  assert.equal(result.metrics.attackSuccessCandidate.rate, 0);
  assert.ok(result.metrics.attackSuccessCandidate.interval.upper > 0);
  assert.equal(result.policy.custom, false); assert.equal(result.policy.version, 'demo-conservative-0.1');
});
test('unspecified sampling suppresses every interval even with adequate N', () => {
  const result = analyze(fixture(100, 'unspecified'));
  Object.values(result.metrics).forEach(metric => { assert.equal(metric.interval, null); assert.match(metric.intervalNote, /명시되지 않아/); });
  assert.equal(result.risk.level, 'LOW_WITHIN_TESTED_SCOPE');
});
test('small N and absent attacks never imply low risk', () => {
  assert.equal(analyze(fixture(99)).risk.level, 'INSUFFICIENT');
  const input = fixture(); delete input.attacks;
  const result = analyze(input);
  assert.equal(result.risk.level, 'INSUFFICIENT'); assert.equal(result.counts.attacksProvided, false);
  assert.equal(result.metrics.attackSuccessCandidate.denominator, 0);
  assert.equal(result.metrics.attackSuccessCandidate.rate, null); assert.equal(result.metrics.attackSuccessCandidate.interval, null);
  assert.equal(result.sufficiency.sufficient, false);
});
test('empty observations are valid insufficient evidence with null rates', () => {
  const result = analyze(fixture(0));
  assert.equal(result.risk.level, 'INSUFFICIENT');
  Object.values(result.metrics).forEach(metric => { assert.equal(metric.denominator, 0); assert.equal(metric.rate, null); assert.equal(metric.interval, null); });
});
test('harmful clean regression is HIGH with separate insufficiency', () => {
  const input = fixture(2); input.clean[0].candidate = 'dog';
  const result = analyze(input);
  assert.equal(result.metrics.harmfulRegression.numerator, 1); assert.equal(result.metrics.harmfulRegression.denominator, 2);
  assert.equal(result.metrics.harmfulRegression.rate, 0.5);
  assert.equal(result.risk.level, 'HIGH'); assert.equal(result.sufficiency.sufficient, false);
});
test('new attack success uses eligible N, not previously blocked attack N', () => {
  const input = fixture(3);
  input.attacks[0].baseline = 'dog'; input.attacks[0].candidate = 'dog';
  input.attacks[1].candidate = 'dog';
  const result = analyze(input);
  assert.equal(result.metrics.attackSuccessBaseline.rate, 1 / 3);
  assert.equal(result.metrics.attackSuccessCandidate.rate, 2 / 3);
  assert.equal(result.metrics.introducedAttackSuccess.numerator, 1);
  assert.equal(result.metrics.introducedAttackSuccess.denominator, 3);
  assert.equal(result.metrics.introducedAttackSuccess.rate, 1 / 3);
  assert.equal(result.risk.level, 'HIGH');
});
test('eligibility excludes original target classes and incorrect clean baseline with fixed N', () => {
  const input = fixture(4);
  input.attacks[0].target = 'cat';
  input.clean[1].baseline = 'dog';
  input.clean[2].baseline = 'dog'; input.attacks[2].target = 'cat';
  input.attacks[3].candidate = 'dog';
  const result = analyze(input);
  assert.equal(result.counts.excludedAttacks, 3); assert.equal(result.counts.eligibleAttacks, 1);
  assert.equal(result.attackEligibility.excluded[2].reasons.length, 2);
  for (const key of ['attackSuccessBaseline', 'attackSuccessCandidate', 'introducedAttackSuccess']) assert.equal(result.metrics[key].denominator, 1);
  assert.equal(result.metrics.attackSuccessCandidate.rate, 1);
});
test('existing failures and improvements remain MEDIUM', () => {
  const clean = fixture(1); clean.clean[0].baseline = 'dog'; clean.clean[0].candidate = 'dog';
  assert.equal(analyze(clean).risk.level, 'MEDIUM');
  clean.clean[0].candidate = 'cat';
  assert.equal(analyze(clean).risk.level, 'MEDIUM');
  const attack = fixture(1); attack.attacks[0].baseline = 'dog'; attack.attacks[0].candidate = 'dog';
  const result = analyze(attack);
  assert.equal(result.risk.level, 'MEDIUM'); assert.equal(result.metrics.introducedAttackSuccess.rate, 0);
});
test('output change in ineligible attack is still a change signal', () => {
  const input = fixture(1); input.attacks[0].target = 'cat'; input.attacks[0].candidate = 'other';
  const result = analyze(input);
  assert.equal(result.metrics.attackSuccessCandidate.rate, null);
  assert.equal(result.metrics.attackDisagreement.rate, 1); assert.equal(result.risk.level, 'MEDIUM');
});
test('harmful regression denominator is baseline-correct clean count', () => {
  const input = fixture(3); input.clean[0].baseline = 'dog'; input.clean[0].candidate = 'dog'; input.clean[1].candidate = 'dog';
  const result = analyze(input);
  assert.equal(result.metrics.cleanErrorBaseline.rate, 1 / 3);
  assert.equal(result.metrics.cleanErrorCandidate.rate, 2 / 3);
  assert.equal(result.metrics.harmfulRegression.rate, 1 / 2);
});
test('custom minimum is explicit and changes only sufficiency threshold', () => {
  const result = analyze(fixture(3), { minSamples: 3 });
  assert.equal(result.policy.custom, true); assert.equal(result.policy.minSamples, 3);
  assert.equal(result.risk.level, 'LOW_WITHIN_TESTED_SCOPE');
  const input = fixture(3); input.clean[0].candidate = 'dog';
  assert.equal(analyze(input, { minSamples: 1 }).risk.level, 'HIGH');
  for (const bad of [0, -1, 1.5, '100', null, NaN, Infinity]) assert.throws(() => analyze(fixture(), { minSamples: bad }), MetricsValidationError);
  assert.throws(() => analyze(fixture(), { unknown: 1 }), MetricsValidationError);
});
test('malformed classification values and labels are rejected', () => {
  for (const bad of ['', ' ', ' cat', 'cat ', null, 1, true, {}, [], 'cat\n']) {
    const input = fixture(1); input.clean[0].candidate = bad;
    assert.throws(() => analyze(input), MetricsValidationError);
  }
  const input = fixture(1); input.attacks[0].target = [];
  assert.equal(validate(input).valid, false);
});
test('duplicate and broken sample relations are rejected', () => {
  let input = fixture(2); input.clean[1].id = input.clean[0].id;
  assert.throws(() => analyze(input), /duplicate clean id/);
  input = fixture(2); input.attacks[1].id = input.attacks[0].id;
  assert.throws(() => analyze(input), /duplicate attack id/);
  input = fixture(2); input.attacks[1].cleanId = 'missing';
  assert.throws(() => analyze(input), /no matching clean id/);
  input = fixture(2); input.attacks[1].cleanId = input.attacks[0].cleanId;
  assert.throws(() => analyze(input), /only one attack per clean sample/);
});
test('schema metadata, shapes, and unknown fields are validated', () => {
  for (const bad of [null, [], 1, 'input']) assert.throws(() => analyze(bad), MetricsValidationError);
  for (const change of [{ schemaVersion: '1' }, { provenance: 'real' }, { samplingAssumption: 'maybe' }, { clean: {} }, { attacks: null }, { extra: 1 }]) assert.throws(() => analyze({ ...fixture(1), ...change }), MetricsValidationError);
  const input = fixture(1); input.clean[0].confidence = 0.9;
  assert.throws(() => analyze(input), /unsupported field/);
});
test('analyses are deterministic and do not mutate input', () => {
  const input = fixture(5), before = JSON.stringify(input);
  const a = analyze(input), b = analyze(input);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(input), before);
  a.references[0].title = 'changed';
  assert.notEqual(analyze(input).references[0].title, 'changed');
});

test('unconditional regression and improved counts use all clean samples', () => {
  const input = fixture(4);
  input.clean[0].candidate = 'dog';
  input.clean[1].baseline = 'dog';
  input.clean[2].baseline = 'dog'; input.clean[2].candidate = 'dog';
  const result = analyze(input);
  assert.equal(result.metrics.harmfulRegression.numerator, 1);
  assert.equal(result.metrics.harmfulRegression.denominator, 2);
  assert.equal(result.metrics.harmfulRegressionAll.numerator, 1);
  assert.equal(result.metrics.harmfulRegressionAll.denominator, 4);
  assert.equal(result.metrics.improved.numerator, 1);
  assert.equal(result.metrics.improved.denominator, 4);
  assert.match(result.metrics.attackSuccessBaseline.label, /조건부/);
  Object.values(result.metrics).forEach(value => assert.ok(value.label.length < 45));
});
test('sparse arrays cannot masquerade as measured sample counts', () => {
  const input = fixture(1); input.clean = new Array(100);
  assert.throws(() => analyze(input), MetricsValidationError);
  const attacks = fixture(1); attacks.attacks = new Array(100);
  assert.throws(() => analyze(attacks), MetricsValidationError);
});
