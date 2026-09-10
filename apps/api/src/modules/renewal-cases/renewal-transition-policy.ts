import { ConflictException } from '@nestjs/common';
import { RenewalCaseStatus } from '../../generated/prisma/enums';

// The single authoritative source of legal RenewalCase status transitions for the four manual
// staff actions this application currently exposes (markAwaitingCustomer / markAccepted /
// markDoNotRenew / markFulfilled). Scoped strictly to what the CURRENT Phase 0-2 domain model
// supports — see 03_WORKFLOWS_AND_STATE_MACHINE.md and PHASES/PHASE_02_RENEWAL_ENGINE.md.
//
// RenewalCaseStatus (schema.prisma) also contains Phase 3-6 values (INVOICE_DRAFT, COLLECTING,
// SUSPENDED, REACTIVATION_PENDING, etc.) that are structurally scaffolded but not yet reachable by
// any code path in this application. None of those values appear anywhere in this matrix — a
// missing predecessor set for a target status means "not legal from anywhere yet," which is the
// deliberately safe default until the phase that actually implements that transition exists.
//
// Design notes on the four sets below:
//   - AWAITING_CUSTOMER / ACCEPTED / DO_NOT_RENEW all draw from the same pool of "no decision
//     recorded yet" states (UPCOMING, REMINDER_CYCLE, HUMAN_REVIEW) plus, for ACCEPTED/
//     DO_NOT_RENEW specifically, AWAITING_CUSTOMER itself (a case flagged as awaiting the customer
//     can still resolve either way). ACCEPTED is deliberately NOT a legal predecessor of
//     AWAITING_CUSTOMER — an already-accepted case regressing to "awaiting customer" is exactly the
//     kind of invalid regression this policy exists to prevent.
//   - FULFILLED's only legal predecessor is PAYMENT_CONFIRMED, exactly per
//     03_WORKFLOWS_AND_STATE_MACHINE.md §4 "Payment flow" (quoted verbatim): "Accountant verifies
//     funds: PAYMENT_CONFIRMED, FULFILLED, schedule next renewal cycle...". ACCEPTED is NOT a legal
//     predecessor — that stage precedes invoice/collection/payment, all of which are Phase 3+ and
//     not built. The absence of that machinery is a reason to REJECT the premature transition, not a
//     reason to shortcut it: nothing here implements Invoice/Payment models or Phase 3-6 logic —
//     PAYMENT_CONFIRMED is simply named as the documented predecessor, which currently makes
//     FULFILLED unreachable by any code path in this application (nothing sets PAYMENT_CONFIRMED
//     yet either) — the same deliberately-inert-until-its-phase-exists shape already used for
//     HUMAN_REVIEW and RETENTION below.
//     A second, separately documented completion path exists in §7 "Reactivation": "... -> subscription
//     ACTIVE -> renewal case FULFILLED or CLOSED according to cycle outcome" — i.e. after a
//     suspended subscription is reactivated. That path depends on Phase 6 suspension/reactivation
//     (SUSPENDED/REACTIVATION_PENDING), which also does not exist yet. It is deliberately NOT added
//     to this matrix as a second predecessor for FULFILLED — doing so would silently broaden
//     markFulfilled() to also serve as a reactivation-completion action, which is a distinct
//     documented workflow this application has no code for yet, not a synonym for the payment path.
//     If/when Phase 6 is built, that path should get its own explicit transition (and likely its own
//     dedicated action), not be folded into markFulfilled()'s existing predecessor set.
//   - HUMAN_REVIEW is included as a legal predecessor throughout even though no current code path
//     sets it yet (it is produced by Phase 3 AI classification, not built) — included for forward
//     consistency with the documented state machine, not because it is reachable today.
//   - RETENTION is not a legal predecessor of anything here: recovering from retention requires the
//     RetentionCase workflow (Phase 4/5), which does not exist. No code path sets RETENTION today
//     either.
const LEGAL_PREDECESSORS: Partial<Record<RenewalCaseStatus, RenewalCaseStatus[]>> = {
  [RenewalCaseStatus.AWAITING_CUSTOMER]: [
    RenewalCaseStatus.UPCOMING,
    RenewalCaseStatus.REMINDER_CYCLE,
    RenewalCaseStatus.HUMAN_REVIEW,
  ],
  [RenewalCaseStatus.ACCEPTED]: [
    RenewalCaseStatus.UPCOMING,
    RenewalCaseStatus.REMINDER_CYCLE,
    RenewalCaseStatus.AWAITING_CUSTOMER,
    RenewalCaseStatus.HUMAN_REVIEW,
  ],
  [RenewalCaseStatus.DO_NOT_RENEW]: [
    RenewalCaseStatus.UPCOMING,
    RenewalCaseStatus.REMINDER_CYCLE,
    RenewalCaseStatus.AWAITING_CUSTOMER,
    RenewalCaseStatus.HUMAN_REVIEW,
  ],
  [RenewalCaseStatus.FULFILLED]: [RenewalCaseStatus.PAYMENT_CONFIRMED],
};

export function isLegalRenewalCaseTransition(
  from: RenewalCaseStatus,
  to: RenewalCaseStatus,
): boolean {
  return (LEGAL_PREDECESSORS[to] ?? []).includes(from);
}

export function assertLegalRenewalCaseTransition(
  from: RenewalCaseStatus,
  to: RenewalCaseStatus,
): void {
  if (!isLegalRenewalCaseTransition(from, to)) {
    throw new ConflictException(
      `Renewal Case cannot move from ${from} to ${to}. This transition is not permitted by the current Phase 0-2 workflow.`,
    );
  }
}
