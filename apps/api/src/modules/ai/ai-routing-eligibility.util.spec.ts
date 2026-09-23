import { AiIntent, AiRoutingAction } from '../../generated/prisma/enums';
import { decideClassificationTimeRoutingAction } from './ai-routing-eligibility.util';

const NOW = new Date('2026-02-01T00:00:00.000Z');
const AT_CUTOVER = new Date('2026-02-01T00:00:00.000Z');
const CUTOVER_IN_PAST = new Date('2026-01-01T00:00:00.000Z');

function base(overrides: Partial<Parameters<typeof decideClassificationTimeRoutingAction>[0]> = {}) {
  return {
    intent: AiIntent.ACCEPT_RENEWAL,
    renewalCaseId: 'case-1',
    autoRouteAcceptEnabled: true,
    cutoverAt: CUTOVER_IN_PAST,
    now: NOW,
    messageCreatedAt: NOW,
    messageOccurredAt: NOW,
    ...overrides,
  };
}

describe('decideClassificationTimeRoutingAction (Slice G §6)', () => {
  it('AUTO_ACCEPT when every condition holds', () => {
    expect(decideClassificationTimeRoutingAction(base())).toBe(AiRoutingAction.AUTO_ACCEPT);
  });

  it('exactly at the cutover instant is eligible (>=, not >)', () => {
    expect(decideClassificationTimeRoutingAction(base({ cutoverAt: AT_CUTOVER, now: NOW }))).toBe(AiRoutingAction.AUTO_ACCEPT);
  });

  it('HUMAN_REVIEW when the intent is not ACCEPT_RENEWAL', () => {
    expect(decideClassificationTimeRoutingAction(base({ intent: AiIntent.REJECT_RENEWAL }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });

  it('HUMAN_REVIEW when auto-routing is disabled', () => {
    expect(decideClassificationTimeRoutingAction(base({ autoRouteAcceptEnabled: false }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });

  it('HUMAN_REVIEW when there is no linked RenewalCase', () => {
    expect(decideClassificationTimeRoutingAction(base({ renewalCaseId: null }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });

  it('HUMAN_REVIEW when now is strictly before the cutover', () => {
    const cutoverInFuture = new Date('2026-02-02T00:00:00.000Z');
    expect(decideClassificationTimeRoutingAction(base({ cutoverAt: cutoverInFuture, now: NOW }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });

  it('HUMAN_REVIEW when cutoverAt is null (auto-routing enabled but no cutover configured — defensive; environment.ts should already prevent this combination)', () => {
    expect(decideClassificationTimeRoutingAction(base({ cutoverAt: null }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });

  describe('contract-audit hardening — historical PENDING mail must never auto-route (§1)', () => {
    // Cutover = 2026-01-15. "Historical" = ingested/occurred before it; classification itself always
    // runs at NOW (2026-02-01, well after) — proving `now >= cutover` alone is insufficient.
    const CUTOVER = new Date('2026-01-15T00:00:00.000Z');
    const BEFORE = new Date('2026-01-10T00:00:00.000Z');
    const AFTER = new Date('2026-01-20T00:00:00.000Z');

    it('A — createdAt BEFORE cutover, occurredAt BEFORE cutover, classified AFTER cutover: HUMAN_REVIEW, never AUTO_ACCEPT', () => {
      const result = decideClassificationTimeRoutingAction(
        base({ cutoverAt: CUTOVER, messageCreatedAt: BEFORE, messageOccurredAt: BEFORE }),
      );
      expect(result).toBe(AiRoutingAction.HUMAN_REVIEW);
    });

    it('B — createdAt AFTER cutover but occurredAt BEFORE cutover: HUMAN_REVIEW', () => {
      const result = decideClassificationTimeRoutingAction(
        base({ cutoverAt: CUTOVER, messageCreatedAt: AFTER, messageOccurredAt: BEFORE }),
      );
      expect(result).toBe(AiRoutingAction.HUMAN_REVIEW);
    });

    it('C — createdAt BEFORE cutover but occurredAt AFTER cutover: HUMAN_REVIEW', () => {
      const result = decideClassificationTimeRoutingAction(
        base({ cutoverAt: CUTOVER, messageCreatedAt: BEFORE, messageOccurredAt: AFTER }),
      );
      expect(result).toBe(AiRoutingAction.HUMAN_REVIEW);
    });

    it('D — createdAt AFTER cutover AND occurredAt AFTER cutover, classified AFTER cutover, all else valid: AUTO_ACCEPT', () => {
      const result = decideClassificationTimeRoutingAction(
        base({ cutoverAt: CUTOVER, messageCreatedAt: AFTER, messageOccurredAt: AFTER }),
      );
      expect(result).toBe(AiRoutingAction.AUTO_ACCEPT);
    });

    it('exactly at the cutover instant, for BOTH message timestamps, is still eligible (>=, not >)', () => {
      const result = decideClassificationTimeRoutingAction(
        base({ cutoverAt: CUTOVER, messageCreatedAt: CUTOVER, messageOccurredAt: CUTOVER }),
      );
      expect(result).toBe(AiRoutingAction.AUTO_ACCEPT);
    });
  });

  it.each([
    AiIntent.REJECT_RENEWAL,
    AiIntent.REQUEST_INVOICE,
    AiIntent.PAYMENT_REPORTED,
    AiIntent.REQUEST_UPGRADE,
    AiIntent.REQUEST_DOWNGRADE,
    AiIntent.REQUEST_CLARIFICATION,
    AiIntent.PRICE_DISPUTE,
    AiIntent.COMPLAINT,
    AiIntent.OTHER,
    AiIntent.UNCLEAR,
  ])('§23 — every non-ACCEPT_RENEWAL intent (%s) is HUMAN_REVIEW even with auto-routing fully enabled', (intent) => {
    expect(decideClassificationTimeRoutingAction(base({ intent }))).toBe(AiRoutingAction.HUMAN_REVIEW);
  });
});
