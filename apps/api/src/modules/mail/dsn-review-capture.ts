import { createHash } from 'node:crypto';

export interface DsnReviewCapture {
  reason: 'REPORT_SHAPED' | 'REPORT_PART_PRESENT';
  sourceSha256: string;
}

/** Identify report-shaped input, not trustworthy provider evidence. Only inspect
 * bounded top-level headers and parser-supplied MIME part types, never body prose. */
export function captureDsnReview(source: Buffer, partTypes: readonly string[] = []): DsnReviewCapture | null {
  const head = source.subarray(0, 65_536).toString('latin1');
  const boundary = /\r?\n\r?\n/.exec(head);
  const headers = (boundary ? head.slice(0, boundary.index) : head)
    .replace(/\r?\n[ \t]+/g, ' ');
  const report = /(?:^|\r?\n)content-type[ \t]*:[^\r\n]*(?:multipart\s*\/\s*report|message\s*\/\s*(?:global-)?(?:delivery-status|disposition-notification))/i.test(headers);
  const part = partTypes.some(type => /^\s*message\s*\/\s*(?:global-)?(?:delivery-status|disposition-notification)(?:\s*[;]|\s*$)/i.test(type));
  if (!report && !part) return null;
  return { reason: report ? 'REPORT_SHAPED' : 'REPORT_PART_PRESENT', sourceSha256: createHash('sha256').update(source).digest('hex') };
}
