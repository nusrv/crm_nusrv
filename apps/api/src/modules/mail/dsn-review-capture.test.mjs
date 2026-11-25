import assert from 'node:assert/strict';
import test from 'node:test';
import { captureDsnReview } from './dsn-review-capture.ts';
const raw = s => Buffer.from(s);
test('normal customer prose is not classified as transport evidence', () => {
  assert.equal(captureDsnReview(raw('Content-Type: text/plain\r\n\r\nContent-Type: multipart/report\r\n delivery failed')), null);
});
test('folded, duplicate and malformed report metadata are review-only', () => {
  for (const h of ['Content-Type: multipart/report; report-type=bogus', 'Content-Type: multipart/\r\n report', 'Content-Type: text/plain\r\nContent-Type: MESSAGE/DELIVERY-STATUS']) {
    const v = captureDsnReview(raw(h+'\r\n\r\nbody'));
    assert.equal(v.reason,'REPORT_SHAPED'); assert.match(v.sourceSha256,/^[a-f0-9]{64}$/);
  }
});
test('nested report parts route to review without asserting delivery', () => {
  const v = captureDsnReview(raw('Content-Type: multipart/mixed\r\n\r\nbody'), ['message/global-delivery-status']);
  assert.equal(v.reason,'REPORT_PART_PRESENT'); assert.deepEqual(Object.keys(v).sort(),['reason','sourceSha256']);
});
test('digest covers exact fetched bytes', () => {
  const a = raw('Content-Type: multipart/report\n\na'), b = raw('Content-Type: multipart/report\n\nb');
  assert.deepEqual(captureDsnReview(a),captureDsnReview(a));
  assert.notEqual(captureDsnReview(a).sourceSha256,captureDsnReview(b).sourceSha256);
});
