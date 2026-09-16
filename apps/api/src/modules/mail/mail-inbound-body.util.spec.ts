import {
  MAX_BODY_TEXT_BYTES,
  deriveInboundBodyHtml,
  deriveInboundBodyText,
  truncateUtf8Bytes,
} from './mail-inbound-body.util';

describe('truncateUtf8Bytes', () => {
  it('returns the input unchanged when already within the byte budget', () => {
    expect(truncateUtf8Bytes('hello', 100)).toBe('hello');
  });

  it('truncates pure ASCII cleanly at the byte boundary', () => {
    expect(truncateUtf8Bytes('abcdefghij', 5)).toBe('abcde');
  });

  it('never splits a 2-byte UTF-8 character (Arabic)', () => {
    const arabic = 'مرحبا'; // each letter is 2 bytes in UTF-8
    for (let n = 1; n <= Buffer.byteLength(arabic, 'utf8'); n++) {
      const result = truncateUtf8Bytes(arabic, n);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(n);
      // Re-encoding must round-trip exactly — proves no partial byte sequence leaked through.
      expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
    }
  });

  it('never splits a 4-byte UTF-8 character (emoji, surrogate pair in JS)', () => {
    const emoji = '😀😃😄😁'; // each is a 4-byte UTF-8 sequence / UTF-16 surrogate pair
    for (let n = 1; n <= Buffer.byteLength(emoji, 'utf8'); n++) {
      const result = truncateUtf8Bytes(emoji, n);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(n);
      expect(result).not.toContain('�'); // no replacement-character corruption
      // Every remaining char must itself be a complete, valid surrogate pair (or empty).
      expect(result.length % 2).toBe(0);
    }
  });

  it('handles a mixed ASCII + multi-byte string without corrupting either part', () => {
    const mixed = 'Hello مرحبا 😀 world';
    const bytes = Buffer.byteLength(mixed, 'utf8');
    const result = truncateUtf8Bytes(mixed, Math.floor(bytes / 2));
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(Math.floor(bytes / 2));
    expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
  });

  it('returns an empty string for a zero or negative byte budget', () => {
    expect(truncateUtf8Bytes('hello', 0)).toBe('');
    expect(truncateUtf8Bytes('hello', -1)).toBe('');
  });
});

describe('deriveInboundBodyText', () => {
  it('prefers text/plain when present', () => {
    expect(deriveInboundBodyText('plain body', '<p>html body</p>')).toBe('plain body');
  });

  it('derives safe plain text from HTML-only messages', () => {
    const html = '<html><body><p>Hello there</p><p>Second paragraph</p></body></html>';
    expect(deriveInboundBodyText(undefined, html)).toBe('Hello there\n\nSecond paragraph');
  });

  it('never executes/renders script or style content, and never includes it in the result', () => {
    const html = '<html><body><script>alert(1)</script><style>.x{color:red}</style><p>Safe text</p></body></html>';
    const result = deriveInboundBodyText(undefined, html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color:red');
    expect(result).toBe('Safe text');
  });

  it('converts <br> and block boundaries into newlines', () => {
    const html = 'Line one<br>Line two';
    expect(deriveInboundBodyText(undefined, html)).toBe('Line one\nLine two');
  });

  it('decodes common HTML entities', () => {
    const html = '<p>Tom &amp; Jerry &lt;tag&gt; &quot;quoted&quot;</p>';
    expect(deriveInboundBodyText(undefined, html)).toBe('Tom & Jerry <tag> "quoted"');
  });

  it('returns an empty string when neither text nor HTML is usable (caller must classify HUMAN_REVIEW)', () => {
    expect(deriveInboundBodyText(undefined, undefined)).toBe('');
    expect(deriveInboundBodyText('', false)).toBe('');
    expect(deriveInboundBodyText('   ', '   ')).toBe('');
  });

  it('bounds ASCII text to MAX_BODY_TEXT_BYTES (safely under the real TEXT column limit)', () => {
    const huge = 'a'.repeat(MAX_BODY_TEXT_BYTES + 5_000);
    const result = deriveInboundBodyText(huge, undefined);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(MAX_BODY_TEXT_BYTES);
    expect(result.endsWith('[... truncated ...]')).toBe(true);
  });

  it('bounds 4-byte UTF-8 (emoji) content by bytes, never splitting a character, staying under MariaDB TEXT capacity', () => {
    const huge = '😀'.repeat(30_000); // 4 bytes each = 120,000 bytes, well over the 65,535 TEXT max
    const result = deriveInboundBodyText(huge, undefined);
    const resultBytes = Buffer.byteLength(result, 'utf8');
    expect(resultBytes).toBeLessThanOrEqual(MAX_BODY_TEXT_BYTES);
    expect(resultBytes).toBeLessThan(65_535); // must actually fit the real MariaDB TEXT column
    expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result); // no corrupted trailing bytes
  });

  it('bounds Arabic (2-byte UTF-8) content by bytes', () => {
    const huge = 'مرحبا بالعالم '.repeat(10_000);
    const result = deriveInboundBodyText(huge, undefined);
    const resultBytes = Buffer.byteLength(result, 'utf8');
    expect(resultBytes).toBeLessThanOrEqual(MAX_BODY_TEXT_BYTES);
    expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
  });

  it('never fetches or embeds a remote image/resource reference — it is only stripped as a tag', () => {
    const html = '<img src="https://evil.example.com/track.gif">Body text';
    const result = deriveInboundBodyText(undefined, html);
    expect(result).not.toContain('evil.example.com');
    expect(result.trim()).toBe('Body text');
  });
});

describe('deriveInboundBodyHtml', () => {
  it('returns undefined when there is no HTML part', () => {
    expect(deriveInboundBodyHtml(undefined)).toBeUndefined();
    expect(deriveInboundBodyHtml(false)).toBeUndefined();
    expect(deriveInboundBodyHtml('   ')).toBeUndefined();
  });

  it('stores the raw HTML source (untrusted, never rendered by this slice) when present', () => {
    expect(deriveInboundBodyHtml('<p>hi</p>')).toBe('<p>hi</p>');
  });

  it('bounds stored HTML by UTF-8 bytes, safely under the real TEXT column limit', () => {
    const huge = '<p>' + 'a'.repeat(MAX_BODY_TEXT_BYTES + 5_000) + '</p>';
    const result = deriveInboundBodyHtml(huge);
    expect(result).toBeDefined();
    expect(Buffer.byteLength(result!, 'utf8')).toBeLessThanOrEqual(MAX_BODY_TEXT_BYTES);
  });
});
