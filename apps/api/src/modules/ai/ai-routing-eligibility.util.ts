import { AiIntent, AiRoutingAction } from '../../generated/prisma/enums';

/**
 * Slice G §6 — the ONE place the classification-time routing-action snapshot is decided. Pure and
 * side-effect-free: given the exact facts available at the moment an AiClassification is persisted,
 * returns the action to freeze onto its AiRoutingDecision row forever. Called ONLY when
 * finalStatus === CLASSIFIED (see AiClassificationService.persistClassification()) — a
 * finalStatus === HUMAN_REVIEW classification never calls this at all; it always gets
 * action=HUMAN_REVIEW, already-completed, by construction (§7).
 *
 * §6/§H — this decision is never revisited later. A future config flip (AI_AUTO_ROUTE_ACCEPT
 * false->true, or a routingVersion bump) must never reinterpret an already-created row; it can only
 * change what NEW classifications decide from that point on.
 */
export interface ClassificationTimeRoutingInput {
  intent: AiIntent;
  /** null when the EmailMessage has no linked RenewalCase at all. */
  renewalCaseId: string | null;
  autoRouteAcceptEnabled: boolean;
  /** null when AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT is not configured (only possible when
   * autoRouteAcceptEnabled is false — environment.ts requires the cutover whenever the switch is
   * true). */
  cutoverAt: Date | null;
  now: Date;
  /** Contract-audit hardening — Slice D deliberately supports classifying a historical EmailMessage
   * that remained PENDING while AI was disabled (its own recovery scan). A message ingested/occurred
   * BEFORE the cutover must never auto-route just because the classification CALL happened to run
   * after the cutover — `now >= cutoverAt` alone is not sufficient. Both of the message's own
   * trusted persisted timestamps must also be at/after the cutover. */
  messageCreatedAt: Date;
  messageOccurredAt: Date;
}

export function decideClassificationTimeRoutingAction(input: ClassificationTimeRoutingInput): AiRoutingAction {
  const cutoverMs = input.cutoverAt?.getTime() ?? null;
  const eligibleForAutoAccept =
    input.intent === AiIntent.ACCEPT_RENEWAL &&
    input.autoRouteAcceptEnabled &&
    cutoverMs !== null &&
    input.now.getTime() >= cutoverMs &&
    input.messageCreatedAt.getTime() >= cutoverMs &&
    input.messageOccurredAt.getTime() >= cutoverMs &&
    input.renewalCaseId !== null;

  return eligibleForAutoAccept ? AiRoutingAction.AUTO_ACCEPT : AiRoutingAction.HUMAN_REVIEW;
}
