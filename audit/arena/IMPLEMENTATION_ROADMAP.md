# IMPLEMENTATION ROADMAP (for a later, separately authorized coding stage)

Authoritative priorities, scope and designs: `FINAL_MASTER_PLAN.md`. Tests: `ACCEPTANCE_TESTS.md`.

| Step | Work | Depends on | Done when |
|---|---|---|---|
| 1 (P0-a) | Migrations (+`nextAttemptAt`), Prisma generate, nullable-type repair, extend live runner | – | fresh+populated DB migrate; typecheck/lint/build green; live specs pass |
| 2 (P0-b, parallel) | A-05 renderer; A-02 PNG validator; A-03 fairness; SC-02 UI gate; S-1 session recovery | 1 for DB-backed tests | acceptance tests P0-b pass |
| 3 (P0-c) | AI gate+disposition, human-only mail proof, JoFotara/technical-action spies, mixed-version rehearsal | 1,2 | P0-c tests pass |
| 4 (P1-ops) | Renewals UI + server contracts, four decisions, truthful read state, legacy-proposal action, race recovery | 1,3 + OD-1,5,6,7 decisions | P1 reminder/reply/period tests pass |
| 5 (P1-fin) | Create Invoice from renewal, free invoice, payments+receipts UI, replay-safe payments | 1,4 + OD-3,4,11 | P1 invoice/payment/receipt tests pass |
| 6 (P2) | Modal stack, nav, labels, helper text, CI, compose loopback, perf | 4,5 | P2 tests pass; A4 print compare |
| 7 | Full regression once; owner review; push/deploy only with owner authorization | all | owner sign-off |

Rules: no `npm audit fix`, no unrelated upgrades, no JoFotara/provider calls, no production credentials; keep `PROJECT_STATUS.md` current; logical local commits.
