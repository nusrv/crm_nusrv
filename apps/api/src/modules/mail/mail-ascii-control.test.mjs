import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAsciiControl } from './mail-ascii-control.ts';

test('ASCII control guard preserves the exact original range', () => {
  for (let code = 0; code < 256; code += 1) {
    assert.equal(hasAsciiControl(`a${String.fromCharCode(code)}b`), code <= 31 || code === 127, `code ${code}`);
  }
  for (const value of ['', 'Arabic العربية', '😀', '\ud800', '\udfff']) {
    assert.equal(hasAsciiControl(value), false);
  }
});
