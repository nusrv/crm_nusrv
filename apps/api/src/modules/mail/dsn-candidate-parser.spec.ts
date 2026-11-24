import { parseDsnCandidate, selectDsnInboundTriage, type DsnMimeReportInput } from './dsn-candidate-parser';

const report = [
  'Reporting-MTA: dns; mx.test.example',
  '',
  'Final-Recipient: rfc822;billing@example.test',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 unknown recipient',
  '',
  'Final-Recipient: rfc822;other@example.test',
  'Action: delayed',
  'Status: 4.2.0',
].join('\r\n');

function input(overrides: Partial<DsnMimeReportInput> = {}): DsnMimeReportInput {
  return {
    mailConfigurationId: 'mail-A',
    sourceObjectId: 'imap-uid-11',
    outerContentType: 'multipart/report; boundary="ABC123"; report-type="delivery-status"',
    reportPartContentType: 'message/delivery-status',
    reportPartText: report,
    ...overrides,
  };
}

describe('P2.D isolated DSN candidate parsing (no provider trust and no side effects)', () => {
  it('extracts bounded per-recipient candidates but never declares a confirmed bounce or delivery', () => {
    const value = parseDsnCandidate(input());
    expect(value).toEqual({
      kind: 'CANDIDATE_DSN',
      sourceObjectId: 'imap-uid-11',
      mailConfigurationId: 'mail-A',
      recipients: [
        {
          claimedFinalRecipient: 'billing@example.test',
          action: 'failed',
          enhancedStatus: '5.1.1',
          disposition: 'HARD',
        },
        {
          claimedFinalRecipient: 'other@example.test',
          action: 'delayed',
          enhancedStatus: '4.2.0',
          disposition: 'SOFT',
        },
      ],
      deliveryStatus: 'UNKNOWN',
      requiresHumanReview: true,
    });
    // No source-to-outbound linkage, no trusted recipient, and no raw diagnostic.
    expect(Object.keys(value)).not.toContain('attemptId');
    expect(JSON.stringify(value)).not.toContain('550 unknown recipient');
    expect(JSON.stringify(value)).not.toContain('CONFIRMED_BOUNCE');
  });

  it('does not treat subject-like or plain inbound text as a DSN', () => {
    for (const outerContentType of [
      'text/plain',
      'multipart/mixed',
      'multipart/report; report-type=delivery-status-other',
      'multipart/report; report-type=delivery-status; report-type=other',
      'multipart/report',
    ]) {
      expect(parseDsnCandidate(input({ outerContentType }))).toEqual({ kind: 'NOT_DSN' });
    }
  });

  it('rejects missing delivery-status MIME report part without scanning message bodies', () => {
    expect(parseDsnCandidate(input({ reportPartContentType: 'text/plain' })))
      .toEqual({ kind: 'UNUSABLE_DSN', problem: 'MISSING_STRUCTURED_PART', deliveryStatus: 'UNKNOWN' });
    expect(parseDsnCandidate(input({ reportPartText: null })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_STRUCTURED_PART' });
  });

  it('fails closed for repeated, contradictory, or missing recipient fields', () => {
    for (const broken of [
      report.replace('Action: failed', 'Action: failed\r\nAction: failed'),
      report.replace('Status: 5.1.1', 'Status: 5.1.1\r\nStatus: 5.1.2'),
      report.replace('Final-Recipient: rfc822;billing@example.test', 'Original-Recipient: rfc822;billing@example.test'),
      report.replace('Action: delayed\r\nStatus: 4.2.0', 'Action: delayed\r\nStatus: 5.1.1'),
      report.replace('Action: failed', 'Action: delivered'),
      report.replace('Status: 5.1.1', 'Status: nonsense'),
      report.replace('Final-Recipient: rfc822;billing@example.test', 'Final-Recipient: unknown; billing@example.test'),
      report.replace('other@example.test', 'billing@example.test'),
    ]) {
      expect(parseDsnCandidate(input({ reportPartText: broken })).kind).toBe('UNUSABLE_DSN');
    }
  });

  it('does not elevate Action failed with transient 4.x.x status to a hard bounce', () => {
    const raw = report
      .replace('Status: 5.1.1', 'Status: 4.1.1')
      .replace('Final-Recipient: rfc822;other@example.test\r\nAction: delayed\r\nStatus: 4.2.0', '');
    const value = parseDsnCandidate(input({ reportPartText: raw }));
    expect(value).toMatchObject({
      kind: 'CANDIDATE_DSN',
      recipients: [expect.objectContaining({ disposition: 'UNCLASSIFIED' })],
      deliveryStatus: 'UNKNOWN',
    });
  });

  it('rejects oversized, ambiguous and corrupted MIME reports', () => {
    const recipients = Array.from({ length: 33 }, (_, index) =>
      `Final-Recipient: rfc822;person${index}@example.test\r\nAction: failed\r\nStatus: 5.1.1`).join('\r\n\r\n');
    for (const bad of [
      `Reporting-MTA: dns; mx.test.example\r\n\r\n${recipients}`,
      report + 'x'.repeat(70_000),
      report.replace('Action: failed', 'Action: fai\0led'),
      report.replace('Action: failed', 'Action: failed\rX-Injected: true'),
      report.replace('Action: failed', `Action: ${'x'.repeat(1100)}`),
      report.replace('Reporting-MTA: dns; mx.test.example', 'Subject: reply pretending to be a DSN'),
    ]) {
      expect(parseDsnCandidate(input({ reportPartText: bad })).kind).toBe('UNUSABLE_DSN');
    }
  });

  it('rejects absent source identities and never guesses the mailbox', () => {
    expect(parseDsnCandidate(input({ mailConfigurationId: '' })))
      .toEqual({ kind: 'UNUSABLE_DSN', problem: 'MISSING_SOURCE_IDENTITY', deliveryStatus: 'UNKNOWN' });
    expect(parseDsnCandidate(input({ sourceObjectId: ' ' })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_SOURCE_IDENTITY' });
  });

  it('routes every DSN-shaped result to human review, never ordinary customer reply correlation', () => {
    const candidate = parseDsnCandidate(input());
    expect(selectDsnInboundTriage(candidate)).toEqual({
      lane: 'DSN_HUMAN_REVIEW',
      mayUseCustomerReplyCorrelation: false,
      deliveryStatus: 'UNKNOWN',
      evidenceKind: 'CANDIDATE_DSN',
    });
    const malformed = parseDsnCandidate(input({
      reportPartText: report.replace('Status: 5.1.1', 'Status: not-a-status'),
    }));
    expect(selectDsnInboundTriage(malformed)).toEqual({
      lane: 'DSN_HUMAN_REVIEW',
      mayUseCustomerReplyCorrelation: false,
      deliveryStatus: 'UNKNOWN',
      evidenceKind: 'UNUSABLE_DSN',
    });
    const normal = parseDsnCandidate(input({ outerContentType: 'text/plain' }));
    expect(selectDsnInboundTriage(normal)).toEqual({
      lane: 'ORDINARY_INBOUND',
      mayUseCustomerReplyCorrelation: true,
    });
  });

  it('fails safely on malformed runtime MIME fields and control characters in source identifiers', () => {
    expect(parseDsnCandidate(input({ outerContentType: 123 as never })))
      .toEqual({ kind: 'NOT_DSN' });
    expect(parseDsnCandidate(input({ reportPartContentType: {} as never })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_STRUCTURED_PART' });
    expect(parseDsnCandidate(input({ reportPartText: 12 as never })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_STRUCTURED_PART' });
    expect(parseDsnCandidate(input({ mailConfigurationId: 'mail\\r\\nspoof' })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_SOURCE_IDENTITY' });
    expect(parseDsnCandidate(input({ sourceObjectId: 'uid\\u0000spoof' })))
      .toMatchObject({ kind: 'UNUSABLE_DSN', problem: 'MISSING_SOURCE_IDENTITY' });
  });

  it('allows header folding while keeping recipient claims explicitly untrusted', () => {
    const folded = report.replace(
      'Final-Recipient: rfc822;billing@example.test',
      'Final-Recipient: rfc822;\r\n billing@example.test',
    );
    const parsed = parseDsnCandidate(input({ reportPartText: folded }));
    expect(parsed).toMatchObject({
      kind: 'CANDIDATE_DSN',
      recipients: [expect.objectContaining({
        claimedFinalRecipient: 'billing@example.test',
      })],
      requiresHumanReview: true,
      deliveryStatus: 'UNKNOWN',
    });
  });
});
