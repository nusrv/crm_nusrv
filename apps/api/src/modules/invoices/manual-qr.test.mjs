import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { isManualQrImage } from './manual-qr.ts';

// Ordinary image fixtures, which deliberately contain no QR codes.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==', 'base64');
const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const dataUrl = (mime, bytes) => 'data:image/' + mime + ';base64,' + bytes.toString('base64');

for (const [mime, bytes] of Object.entries({ png, jpeg, webp })) {
  test(mime + ' accepts an ordinary image and rejects malformed containers', () => {
    assert.equal(isManualQrImage(dataUrl(mime, bytes)), true);
    assert.equal(isManualQrImage(dataUrl(mime, bytes.subarray(0, -1))), false);
    assert.equal(isManualQrImage(dataUrl(mime, Buffer.concat([bytes, Buffer.from('trailer')]))), false);
    assert.equal(isManualQrImage(dataUrl(mime === 'png' ? 'jpeg' : 'png', bytes)), false);
  });
}

test('rejects oversized dimensions with otherwise intact image headers', () => {
  const hugePng = Buffer.from(png);
  hugePng.writeUInt32BE(4097, 16);
  hugePng.writeUInt32BE(crc32(hugePng.subarray(12, 29)), 29);
  assert.equal(isManualQrImage(dataUrl('png', hugePng)), false);

  const hugeJpeg = Buffer.from(jpeg);
  const frame = hugeJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(frame !== -1);
  hugeJpeg.writeUInt16BE(4097, frame + 7);
  assert.equal(isManualQrImage(dataUrl('jpeg', hugeJpeg)), false);

  const hugeWebp = Buffer.from(webp);
  hugeWebp.writeUInt32LE(hugeWebp.readUInt32LE(21) | 0x3fff, 21);
  assert.equal(isManualQrImage(dataUrl('webp', hugeWebp)), false);
});

test('rejects malformed base64, bad CRC, unsafe encoded size and deceptive signatures', () => {
  const corrupt = Buffer.from(png);
  corrupt[41] ^= 1;
  assert.equal(isManualQrImage(dataUrl('png', corrupt)), false);
  assert.equal(isManualQrImage(dataUrl('png', png).replace(/=+$/, '')), false);
  assert.equal(isManualQrImage(dataUrl('png', png) + '\n'), false);
  assert.equal(isManualQrImage(dataUrl('svg+xml', Buffer.from('<svg/>'))), false);
  assert.equal(isManualQrImage(dataUrl('png', Buffer.alloc(45_001))), false);
  assert.equal(isManualQrImage(dataUrl('png', png.subarray(0, 24))), false);
  assert.equal(isManualQrImage(dataUrl('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 0xff, 0xd9]))), false);
  assert.equal(isManualQrImage(dataUrl('webp', webp.subarray(0, 16))), false);
});
