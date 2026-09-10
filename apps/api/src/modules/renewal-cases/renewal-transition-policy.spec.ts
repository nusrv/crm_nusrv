import { RenewalCaseStatus } from '../../generated/prisma/enums';
import {
  assertLegalRenewalCaseTransition,
  isLegalRenewalCaseTransition,
} from './renewal-transition-policy';

describe('renewal-transition-policy', () => {
  it.each([
    [RenewalCaseStatus.UPCOMING, RenewalCaseStatus.AWAITING_CUSTOMER],
    [RenewalCaseStatus.REMINDER_CYCLE, RenewalCaseStatus.AWAITING_CUSTOMER],
    [RenewalCaseStatus.HUMAN_REVIEW, RenewalCaseStatus.AWAITING_CUSTOMER],
    [RenewalCaseStatus.UPCOMING, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.REMINDER_CYCLE, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.AWAITING_CUSTOMER, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.HUMAN_REVIEW, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.UPCOMING, RenewalCaseStatus.DO_NOT_RENEW],
    [RenewalCaseStatus.REMINDER_CYCLE, RenewalCaseStatus.DO_NOT_RENEW],
    [RenewalCaseStatus.AWAITING_CUSTOMER, RenewalCaseStatus.DO_NOT_RENEW],
    [RenewalCaseStatus.HUMAN_REVIEW, RenewalCaseStatus.DO_NOT_RENEW],
    [RenewalCaseStatus.PAYMENT_CONFIRMED, RenewalCaseStatus.FULFILLED],
  ])('allows %s -> %s', (from, to) => {
    expect(isLegalRenewalCaseTransition(from, to)).toBe(true);
    expect(() => assertLegalRenewalCaseTransition(from, to)).not.toThrow();
  });

  it.each([
    // The specific regressions/premature jumps called out explicitly.
    [RenewalCaseStatus.ACCEPTED, RenewalCaseStatus.AWAITING_CUSTOMER],
    [RenewalCaseStatus.UPCOMING, RenewalCaseStatus.FULFILLED],
    // FULFILLED is not a generic "close this case" button — only PAYMENT_CONFIRMED reaches it,
    // per 03_WORKFLOWS_AND_STATE_MACHINE.md §4. ACCEPTED is explicitly NOT a shortcut, even though
    // it is the state immediately before the (unbuilt) invoice/payment chain.
    [RenewalCaseStatus.ACCEPTED, RenewalCaseStatus.FULFILLED],
    [RenewalCaseStatus.REMINDER_CYCLE, RenewalCaseStatus.FULFILLED],
    [RenewalCaseStatus.AWAITING_CUSTOMER, RenewalCaseStatus.FULFILLED],
    [RenewalCaseStatus.HUMAN_REVIEW, RenewalCaseStatus.FULFILLED],
    [RenewalCaseStatus.PAYMENT_REPORTED, RenewalCaseStatus.FULFILLED],
    // No code path today sets RETENTION, and recovering from it needs unbuilt Phase 4/5 machinery.
    [RenewalCaseStatus.RETENTION, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.RETENTION, RenewalCaseStatus.DO_NOT_RENEW],
    // Terminal states are never legal predecessors of anything in this matrix.
    [RenewalCaseStatus.REJECTED, RenewalCaseStatus.ACCEPTED],
    [RenewalCaseStatus.CLOSED, RenewalCaseStatus.AWAITING_CUSTOMER],
    [RenewalCaseStatus.DO_NOT_RENEW, RenewalCaseStatus.ACCEPTED],
    // Phase 3-6 states are structurally scaffolded but never legal predecessors of a current-phase
    // target — nothing in this application can currently produce them anyway.
    [RenewalCaseStatus.INVOICE_DRAFT, RenewalCaseStatus.FULFILLED],
    [RenewalCaseStatus.COLLECTING, RenewalCaseStatus.FULFILLED],
  ])('rejects %s -> %s', (from, to) => {
    expect(isLegalRenewalCaseTransition(from, to)).toBe(false);
    expect(() => assertLegalRenewalCaseTransition(from, to)).toThrow();
  });

  it('rejects every status as a predecessor of itself (no self-loops in the matrix)', () => {
    for (const status of Object.values(RenewalCaseStatus)) {
      expect(isLegalRenewalCaseTransition(status, status)).toBe(false);
    }
  });
});
