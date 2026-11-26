import { ConflictException } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import type { Prisma, RenewalCase } from '../../generated/prisma/client';
import type { ActorType } from '../../generated/prisma/enums';
import { RenewalCaseStatus } from '../../generated/prisma/enums';

// Human-operated CRM tracking transitions. Payment and external technical execution are independent.
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
  [RenewalCaseStatus.FULFILLED]: [RenewalCaseStatus.ACCEPTED, RenewalCaseStatus.INVOICE_DRAFT, RenewalCaseStatus.COLLECTING, RenewalCaseStatus.PAYMENT_CONFIRMED],
  [RenewalCaseStatus.HUMAN_REVIEW]: [RenewalCaseStatus.UPCOMING, RenewalCaseStatus.REMINDER_CYCLE, RenewalCaseStatus.AWAITING_CUSTOMER],
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

/**
 * Slice G §0.F/§L — the ONE shared transition-application primitive, extracted so
 * RenewalCasesService's own human-actor `transitionStatus()` and AiRoutingService's AI-actor
 * auto-accept transition can reuse the EXACT SAME legal-transition check and CAS-write discipline,
 * never a second copy of either. Takes an already-open `tx` so the caller controls the outer
 * transaction boundary (RenewalCasesService opens its own single-purpose transaction; AiRoutingService
 * must fold this into a larger transaction that also touches EmailMessage/AiRoutingDecision/Audit
 * atomically — see that file's own doc comment).
 *
 * `currentRow` must be a value the caller already read (or otherwise knows) to be the row's status
 * at the moment this is called — this function does not re-read it itself before the CAS, exactly
 * mirroring RenewalCasesService.transitionStatus()'s original pre-check-then-CAS shape.
 */
export interface RenewalCaseTransitionActor {
  actorType: ActorType;
  /** Omitted (not merely undefined-valued) for an AI actor — AuditEvent.actorId is nullable and a
   * synthetic/fake user id must never be invented (Slice G §0.H/§12 — frozen owner decision). */
  actorId?: string;
  ipAddress?: string;
}

export type RenewalCaseTransitionResult =
  | { kind: 'applied'; renewalCase: RenewalCase }
  | { kind: 'cas_lost'; currentStatus: RenewalCaseStatus };

export async function applyRenewalCaseTransition(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  input: {
    id: string;
    currentRow: RenewalCase;
    toStatus: RenewalCaseStatus;
    extraData: Record<string, unknown>;
    eventKey: string;
    actor: RenewalCaseTransitionActor;
    auditMetadata?: Record<string, unknown>;
    expectedCommunicationRevision?: number;
  },
): Promise<RenewalCaseTransitionResult> {
  // Re-asserted here (not just by the caller's own pre-check, if any) so this primitive is safe to
  // call directly and can never apply an illegal transition even if a future caller forgets its own
  // pre-check.
  assertLegalRenewalCaseTransition(input.currentRow.status, input.toStatus);

  // The actual concurrency boundary: re-checks status at the moment of the write, not at the moment
  // `input.currentRow` was read — see RenewalCasesService.transitionStatus()'s own doc comment for
  // the full rationale (identical here).
  const result = await tx.renewalCase.updateMany({
    where: { id: input.id, status: input.currentRow.status, ...(input.expectedCommunicationRevision === undefined ? {} : { communicationRevision: input.expectedCommunicationRevision }) },
    data: { status: input.toStatus, ...input.extraData },
  });
  if (result.count === 0) {
    const latest = await tx.renewalCase.findUniqueOrThrow({ where: { id: input.id } });
    return { kind: 'cas_lost', currentStatus: latest.status };
  }

  const renewalCase = await tx.renewalCase.findUniqueOrThrow({ where: { id: input.id } });
  await audit.record(
    {
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      eventKey: input.eventKey,
      subjectType: 'RenewalCase',
      subjectId: input.id,
      oldState: input.currentRow,
      newState: renewalCase,
      metadata: input.auditMetadata,
      ipAddress: input.actor.ipAddress,
    },
    tx,
  );
  return { kind: 'applied', renewalCase };
}
