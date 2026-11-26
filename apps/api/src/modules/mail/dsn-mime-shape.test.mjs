import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDsnMimeShape } from './dsn-mime-shape.ts';

const part = 'message/delivery-status';
const text = 'Reporting-MTA: dns; mx.example.test';
const dsn = 'multipart/report; report-type=delivery-status';

test('ordinary MIME without an extracted report remains ordinary', () => {
  for (const outer of ['text/plain', 'text/html; charset=UTF-8', 'multipart/mixed; boundary="abc;xyz"']) {
    assert.equal(classifyDsnMimeShape(outer, null, null), 'ORDINARY');
  }
});
test('well-formed reports accept quoted parameters, case and escaped boundaries', () => {
  for (const outer of [dsn, 'Multipart/Report; REPORT-TYPE="Delivery-Status"; boundary="A;B\\"C"',
    'multipart/report; boundary="a;report-type=other"; report-type=delivery-status']) {
    assert.equal(classifyDsnMimeShape(outer, part, text), 'STRUCTURED_DSN');
  }
});
test('malformed, duplicate, missing and unsupported report parameters stay in review', () => {
  for (const outer of ['multipart/report', 'multipart/report; report-type=delivery-status-other',
    dsn + '; report-type=other', dsn + '; report-type=delivery-status', 'multipart/report; report-type="delivery-status',
    'multipart/report; boundary="x;report-type=delivery-status"', 'multipart/report; report-type=disposition-notification',
    dsn + '; broken', dsn + '; boundary="x"; boundary="y"']) {
    assert.equal(classifyDsnMimeShape(outer, part, text), 'MALFORMED_REPORT', outer);
  }
});
test('a report part under a non-report wrapper cannot become ordinary customer mail', () => {
  for (const outer of ['text/plain', 'multipart/mixed']) {
    assert.equal(classifyDsnMimeShape(outer, part, text), 'MALFORMED_REPORT');
    assert.equal(classifyDsnMimeShape(outer, null, text), 'MALFORMED_REPORT');
  }
  for (const outer of [part, 'message/global-delivery-status', 'message/disposition-notification']) {
    assert.equal(classifyDsnMimeShape(outer, null, null), 'MALFORMED_REPORT');
  }
});
test('valid report envelope without supported nonempty report part remains review-only', () => {
  for (const [p, t] of [[null, text], ['text/plain', text], [part, null], [part, ''], [part, 3],
    [part + '; broken', text], [part + '; x=' + 'a'.repeat(300), text]]) {
    assert.equal(classifyDsnMimeShape(dsn, p, t), 'MISSING_STRUCTURED_PART');
  }
});
test('malformed, missing, over-limit and injected outer metadata never goes to ordinary correlation', () => {
  for (const outer of [undefined, null, 123, '', 'text/plain extra', 'text/plain; charset=',
    'text/plain\r\nInjected: report-type=delivery-status', 'x'.repeat(1025), 'text/plain; x="unterminated']) {
    assert.equal(classifyDsnMimeShape(outer, null, null), 'MALFORMED_REPORT');
  }
});
