import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoverInputUtc, cutoverUpdate } from './mail-cutover.ts';

test('unchanged cutover preserves exact stored seconds and milliseconds', () => {
  const previous = '2026-11-25T11:30:45.123Z';
  assert.equal(cutoverInputUtc(previous), '2026-11-25T11:30');
  assert.equal(cutoverUpdate('2026-11-25T11:30', previous, true), undefined);
});
test('changed UTC cutover is independent of browser time zone', () => {
  assert.equal(cutoverUpdate('2026-11-25T14:30', null, false), '2026-11-25T14:30:00.000Z');
  assert.equal(cutoverInputUtc('2026-11-25T14:30:00+03:00'), '2026-11-25T11:30');
});
test('clear an existing cutover explicitly; blank new field is omitted', () => {
  assert.equal(cutoverUpdate('', '2026-11-25T11:30:00Z', true), null);
  assert.equal(cutoverUpdate('', null, false), undefined);
});
test('reject invalid and normalized dates', () => {
  for (const value of ['2026-02-30T12:00', '2026-11-25T24:00', 'bad', '2026-11-25T14:30Z']) {
    assert.throws(() => cutoverUpdate(value, null, false));
  }
});
