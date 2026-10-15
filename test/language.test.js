import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLanguage, t, messageFor, unknownLabel } from '../src/i18n.js';
test('main flow labels, validation and unknowns switch without touching factual data', () => {
  chooseLanguage('en');
  assert.equal(t('成员 {n}', {n:2}), 'Member 2');
  assert.equal(messageFor('timeout'), 'Qloo timed out. Please retry.');
  assert.equal(messageFor('bad_input'), 'Invalid input. Check the trip details.');
  assert.equal(unknownLabel('cost'), 'Price');
  assert.equal(t('Blue Note Jazz Club'), 'Blue Note Jazz Club');
  chooseLanguage('zh');
  assert.equal(messageFor('bad_input'), '输入无效，请检查出行条件。');
  assert.equal(t('成员 {n}', {n:2}), '成员 2');
});
