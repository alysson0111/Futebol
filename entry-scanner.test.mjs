import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEntry } from './entry-scanner.mjs';
const payload = { event: { sport: 'football', phase: 'live', elapsed: "60'", score: { home: 1, away: 0 }, home: { id: 'a', name: 'A' }, away: { id: 'b', name: 'B' } }, statistics: [{ team: { id: 'a', name: 'A' }, statistics: [{ type: 'Escanteios', value: 4 }] }, { team: { id: 'b', name: 'B' }, statistics: [{ type: 'Escanteios', value: 3 }] }] };
test('missing independent data blocks confidence and entries, never replaced by contract price', () => {
  const result = assessEntry(payload, 'over-25');
  assert.equal(result.confidence, null);
  assert.equal(result.approved, false);
  assert.equal(result.status, 'Dados insuficientes');
  assert.match(result.reason, /Linha projetada/);
  assert.equal(result.checks.find(check => check.label === 'Pressao por escanteios').value, 7);
});
test('rule score is not hit probability; complete rules still need strategy validation', () => {
  const result = assessEntry(payload, 'over-25', { projectedGoalLine: 3, favoriteHandicap: -.75 });
  assert.equal(result.confidence, 1);
  assert.equal(result.confidenceKind, 'rule-score');
  assert.equal(result.approved, false);
  assert.equal(assessEntry({ ...payload, event: { ...payload.event, phase: 'finished' } }, 'over-25', { projectedGoalLine: 3, favoriteHandicap: -.75, strategyValidated: true }).approved, false);
});
test('missing scores and corners are not zero; unsupported sports cannot produce entries', () => {
  const result = assessEntry({ ...payload, statistics: [], event: { ...payload.event, elapsed: null, score: { home: null, away: null } } }, 'under-25');
  assert.equal(result.confidence, null);
  assert.equal(result.checks.find(check => check.label === 'Placar adequado ao mercado').available, false);
  assert.equal(result.checks.find(check => check.label === 'Pressao por escanteios').available, false);
  assert.equal(assessEntry({ ...payload, event: { ...payload.event, sport: 'basketball' } }, 'over-25', { projectedGoalLine: 3, favoriteHandicap: -.75, strategyValidated: true }).approved, false);
  for (const market of ['corners', 'handicap', 'ml']) assert.equal(assessEntry(payload, market).confidence, null);
  assert.throws(() => assessEntry(payload, 'invalid'));
});
