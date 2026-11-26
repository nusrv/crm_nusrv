# VERIFIED FINDINGS
Classification: VERIFIED = confirmed by source reading by BOTH agents; nothing is runtime-verified. See `FINAL_MASTER_PLAN.md` §B for the full severity table (authoritative) and `CLAUDE_INDEPENDENT_REVIEW.md` for evidence paths.

VERIFIED (static, both agents): A-01 missing migrations; A-02 weak QR validator; A-03 queue starvation (HEAD defect too); A-05 tax slot + prohibited extra line; SC-02 UI payment gate; K-1 Keep in Review absent + HUMAN_REVIEW self-transition illegal; SC-01 AI routing side effect; P-1 payment replay revision bump; M-1 markRead false success; H-1 hold silently defers human sends; F-1 free-invoice period non-null / empty-date handling; U-1 missing UI; T-1 runner omits specs; S-1 dashboard proxy ignores valid refresh (static branch).
STRONGLY SUPPORTED: C-1 nothing writes `Invoice.sourceRenewalCaseId` (negative grep).
PROBABLE: A-07 idempotency races. HYPOTHESIS: A-12 scan performance; prevalence of legacy ACCEPTED-without-proposal and bad historical QR rows.
DISPROVEN / downgraded: claim A-04 is a scope violation (scope §4 does not require immediate revocation); claim "Fulfil can never enable" (legacy PAYMENT_CONFIRMED cases can); Claude's "all §4 behaviours met" (durable logout unproven).
