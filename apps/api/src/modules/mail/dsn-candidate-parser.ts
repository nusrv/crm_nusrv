import { hasAsciiControl } from './mail-evidence-text';
import { classifyDsnMimeShape } from './dsn-mime-shape';

/**
 * P2.D, source-only. Parse an RFC 3464-style message/delivery-status part as
 * UNTRUSTED candidate evidence for later operator review.
 *
 * This helper is NOT in the inbound worker, not a registered service and does
 * not authenticate the origin of the MIME structure, the mailbox, the sender,
 * the original outbound message, the recipient or the attempt.
 *
 * A parsed 5.x.x failure is NOT a confirmed hard bounce. No recipient state,
 * SMTP acceptance, Waiting for Customer, action queue or resend may be changed
 * merely because this function returned CANDIDATE_DSN.
 */
export type DsnCandidateDisposition = 'HARD' | 'SOFT' | 'UNCLASSIFIED';
export type DsnAction = 'failed' | 'delayed' | 'delivered' | 'relayed' | 'expanded';
export type DsnCandidateProblem =
  | 'MISSING_SOURCE_IDENTITY'
  | 'MISSING_STRUCTURED_PART'
  | 'BOUNDS_EXCEEDED'
  | 'INVALID_REPORT_FORMAT'
  | 'AMBIGUOUS_RECIPIENT';

export interface DsnMimeReportInput {
  mailConfigurationId: string;
  sourceObjectId: string;
  /** This is parsed MIME metadata, NOT proof of a trusted mail server. */
  outerContentType: string | null | undefined;
  reportPartContentType: string | null | undefined;
  reportPartText: string | null | undefined;
}

export interface DsnCandidateRecipient {
  /** Claimed DSN recipient, not a verified SMTP envelope recipient. */
  claimedFinalRecipient: string;
  action: DsnAction;
  enhancedStatus: string;
  disposition: DsnCandidateDisposition;
}

export type DsnCandidateParseResult =
  | { kind: 'NOT_DSN' }
  | { kind: 'UNUSABLE_DSN'; problem: DsnCandidateProblem; deliveryStatus: 'UNKNOWN' }
  | {
    kind: 'CANDIDATE_DSN';
    mailConfigurationId: string;
    sourceObjectId: string;
    recipients: DsnCandidateRecipient[];
    deliveryStatus: 'UNKNOWN';
    requiresHumanReview: true;
  };

const MAX_DSN_TEXT_BYTES = 65_536;
const MAX_DSN_LINES = 256;
const MAX_DSN_LINE_CHARS = 1024;
const MAX_DSN_RECIPIENTS = 32;

function unusable(problem: DsnCandidateProblem): DsnCandidateParseResult {
  return { kind: 'UNUSABLE_DSN', problem, deliveryStatus: 'UNKNOWN' };
}

function parseFields(section: string): Map<string, string[]> | null {
  const fields = new Map<string, string[]>();
  let previous: string | null = null;
  for (const line of section.split('\n')) {
    if (/^[ \t]/.test(line)) {
      if (!previous) return null;
      const values = fields.get(previous);
      if (!values?.length) return null;
      values[values.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9-]{0,63}):[ \t]*(.*)$/.exec(line);
    if (!match) return null;
    const field = match[1]!.toLowerCase();
    const values = fields.get(field) ?? [];
    values.push(match[2]!.trim());
    fields.set(field, values);
    previous = field;
  }
  return fields;
}

function exactlyOne(fields: Map<string, string[]>, name: string): string | null {
  const values = fields.get(name);
  return values?.length === 1 ? values[0]! : null;
}

function parseRecipient(fields: Map<string, string[]>): DsnCandidateRecipient | null {
  const rawRecipient = exactlyOne(fields, 'final-recipient');
  const rawAction = exactlyOne(fields, 'action');
  const status = exactlyOne(fields, 'status');
  if (!rawRecipient || !rawAction || !status) return null;

  const recipient = /^rfc822;[ \t]*([^\s;<>]+@[^\s;<>]+)$/i.exec(rawRecipient);
  if (!recipient || recipient[1]!.length > 320) return null;

  if (!/^(failed|delayed|delivered|relayed|expanded)$/.test(rawAction)) return null;
  if (!/^[245]\.[0-9]{1,3}\.[0-9]{1,3}$/.test(status)) return null;

  const action = rawAction as DsnAction;
  const statusClass = status[0]!;
  // Contradictory reports are not allowed to become evidence candidates.
  if ((action === 'delayed' && statusClass !== '4') ||
      ((action === 'delivered' || action === 'relayed' || action === 'expanded') &&
       statusClass !== '2')) return null;

  let disposition: DsnCandidateDisposition = 'UNCLASSIFIED';
  if (action === 'failed' && statusClass === '5') disposition = 'HARD';
  if (action === 'delayed' && statusClass === '4') disposition = 'SOFT';

  return {
    claimedFinalRecipient: recipient[1]!,
    action,
    enhancedStatus: status,
    disposition,
  };
}

/**
 * Caller must already have extracted the MIME part; this function does not
 * parse an RFC822 message or scan freeform body/subject text for bounce hints.
 * Every report remains a candidate even if all RFC fields look legitimate.
 */
export function parseDsnCandidate(input: DsnMimeReportInput): DsnCandidateParseResult {
  if (typeof input.mailConfigurationId !== 'string' ||
      !input.mailConfigurationId.trim() || input.mailConfigurationId.length > 128 ||
      hasAsciiControl(input.mailConfigurationId) ||
      typeof input.sourceObjectId !== 'string' ||
      !input.sourceObjectId.trim() || input.sourceObjectId.length > 256 ||
      hasAsciiControl(input.sourceObjectId)) {
    return unusable('MISSING_SOURCE_IDENTITY');
  }

  // Ambiguous or malformed report-shaped metadata must not fall through
  // to ordinary customer-reply correlation.
  const shape = classifyDsnMimeShape(input.outerContentType, input.reportPartContentType, input.reportPartText);
  if (shape === 'ORDINARY') return { kind: 'NOT_DSN' };
  if (shape === 'MALFORMED_REPORT') return unusable('INVALID_REPORT_FORMAT');
  if (shape === 'MISSING_STRUCTURED_PART' || typeof input.reportPartText !== 'string') {
    return unusable('MISSING_STRUCTURED_PART');
  }

  const raw = input.reportPartText;
  if (Buffer.byteLength(raw, 'utf8') > MAX_DSN_TEXT_BYTES ||
      raw.includes('\0') || /\r(?!\n)/.test(raw)) return unusable('BOUNDS_EXCEEDED');

  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  if (lines.length > MAX_DSN_LINES ||
      lines.some((line) => line.length > MAX_DSN_LINE_CHARS ||
        hasAsciiControl(line, true))) {
    return unusable('BOUNDS_EXCEEDED');
  }

  const sections = normalized.split(/\n[ \t]*\n+/);
  if (sections.length < 2 || sections.length - 1 > MAX_DSN_RECIPIENTS) {
    return unusable('INVALID_REPORT_FORMAT');
  }
  const reportFields = parseFields(sections[0]!);
  if (!reportFields || !exactlyOne(reportFields, 'reporting-mta')) {
    return unusable('INVALID_REPORT_FORMAT');
  }

  const recipients: DsnCandidateRecipient[] = [];
  const seen = new Set<string>();
  for (const section of sections.slice(1)) {
    const fields = parseFields(section);
    if (!fields) return unusable('INVALID_REPORT_FORMAT');
    const candidate = parseRecipient(fields);
    if (!candidate) return unusable('AMBIGUOUS_RECIPIENT');
    // Never select the newest or hardest of multiple contradictory entries.
    if (seen.has(candidate.claimedFinalRecipient)) return unusable('AMBIGUOUS_RECIPIENT');
    seen.add(candidate.claimedFinalRecipient);
    recipients.push(candidate);
  }
  return {
    kind: 'CANDIDATE_DSN',
    mailConfigurationId: input.mailConfigurationId,
    sourceObjectId: input.sourceObjectId,
    recipients,
    deliveryStatus: 'UNKNOWN',
    requiresHumanReview: true,
  };
}

/**
 * Future inbound pipeline routing contract. DSN-shaped and malformed-report
 * messages require specialist human review, never ordinary customer-reply
 * correlation or unread/decision updates. This pure function does NOT wire
 * the policy into the currently running INBOX worker.
 */
export type DsnInboundTriage =
  | { lane: 'ORDINARY_INBOUND'; mayUseCustomerReplyCorrelation: true }
  | {
    lane: 'DSN_HUMAN_REVIEW';
    mayUseCustomerReplyCorrelation: false;
    deliveryStatus: 'UNKNOWN';
    evidenceKind: 'CANDIDATE_DSN' | 'UNUSABLE_DSN';
  };

export function selectDsnInboundTriage(result: DsnCandidateParseResult): DsnInboundTriage {
  if (result.kind === 'NOT_DSN') {
    return { lane: 'ORDINARY_INBOUND', mayUseCustomerReplyCorrelation: true };
  }
  return {
    lane: 'DSN_HUMAN_REVIEW',
    mayUseCustomerReplyCorrelation: false,
    deliveryStatus: 'UNKNOWN',
    evidenceKind: result.kind,
  };
}
