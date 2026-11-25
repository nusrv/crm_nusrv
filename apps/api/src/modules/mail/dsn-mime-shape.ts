import { hasAsciiControl } from './mail-evidence-text';

type MimeShape = 'ORDINARY' | 'STRUCTURED_DSN' | 'MALFORMED_REPORT' | 'MISSING_STRUCTURED_PART';
const MAX_OUTER = 1024;
const MAX_PART = 256;

/** Parse only bounded, unfolded media-type metadata. Quoted semicolons are not parameters. */
function parseMediaType(raw: unknown, max: number): { type: string; parameters: Map<string, string> } | null {
  if (typeof raw !== 'string' || raw.length > max || hasAsciiControl(raw, true)) return null;
  const value = raw.trim();
  const media = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+)/.exec(value);
  if (!media) return null;
  let rest = value.slice(media[0].length);
  const parameters = new Map<string, string>();
  while (rest.trim()) {
    const param = /^\s*;\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([!#$%&'*+.^_`|~0-9A-Za-z-]+))/.exec(rest);
    if (!param) return null;
    const name = param[1]!.toLowerCase();
    if (parameters.has(name)) return null;
    parameters.set(name, param[2] !== undefined ? param[2].replace(/\\(.)/g, '$1') : param[3]!);
    rest = rest.slice(param[0].length);
  }
  return { type: media[0].toLowerCase(), parameters };
}

/**
 * No origin authentication and no body/subject heuristics. An adapter must
 * supply explicit normalized ordinary MIME metadata (including text/plain for
 * a genuinely absent Content-Type), not silently drop failed extraction.
 * Any report-shaped or contradictory metadata remains in specialist review;
 * unsupported report types must not be interpreted as customer replies.
 */
export function classifyDsnMimeShape(outer: unknown, part: unknown, partText: unknown): MimeShape {
  const outerType = parseMediaType(outer, MAX_OUTER);
  if (!outerType) return 'MALFORMED_REPORT';
  if (outerType.type === 'multipart/report') {
    if (outerType.parameters.get('report-type')?.toLowerCase() !== 'delivery-status') return 'MALFORMED_REPORT';
    const partType = parseMediaType(part, MAX_PART);
    if (partType?.type !== 'message/delivery-status' || typeof partText !== 'string' || !partText) {
      return 'MISSING_STRUCTURED_PART';
    }
    return 'STRUCTURED_DSN';
  }
  if (outerType.type === 'message/delivery-status' || outerType.type === 'message/global-delivery-status' ||
      outerType.type === 'message/disposition-notification' || outerType.type === 'message/global-disposition-notification' ||
      (part !== null && part !== undefined) || (partText !== null && partText !== undefined)) return 'MALFORMED_REPORT';
  return 'ORDINARY';
}
