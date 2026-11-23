# Independent challenge readiness

## Executive summary

The audit packet is ready for independent adversarial review. Every finding states its evidence boundary. The most challengeable claims involve runtime effects, phase/version boundaries, SMTP guarantees and assumptions about product policy. A reviewer should be able to confirm the static findings from files and reject any unsupported inference without needing access to production or secrets.

| Objection a reviewer could reasonably raise | Evidence and resolution path |
| --- | --- |
| **Are you comparing unfinished code to a promise it never claimed to deliver?** | Yes, the release assessment compares the local work to the frozen target and marks it unfinished, not a regression shipped to production. Recheck `git status`, `git show HEAD:<path>`, and tracked migration directories. Evaluate capability claims per baseline column. **A-01**, **A-13**. |
| **The QR synthetic case proves a helper returns true, not that production accepts bad official records.** | Correct. Trace the helper into the record transition and print predicate, then run a route-level test with synthetic signature-only bytes and fake persistence in an approved environment. The audit did not create or alter an invoice. A decoded QR still cannot prove tax authority authenticity. **A-02**. |
| **Backoff might not be necessary if the queue usually has fewer than 50 blocked rows.** | The defect is deterministic at the bounded-batch condition. Frequency and impact are unmeasured. Reproduce with fixtures and then gather queue-depth and age distributions before selecting deadlines or alerts. Preserve continuous progress for eligible work. **A-03**, **A-12**. |
| **Stale claim authorization is intentional with 15-minute access JWTs. Why prioritize it?** | The stale window is a confirmed property. The severity reflects consequential accounting and admin roles, not a known incident or a guarantee the owner already demanded immediate revocation everywhere. Quantify time windows and costs, then choose targeted checks or stronger global requirements. **A-04**. |
| **The tax slot may be a legitimate buyer number in a different jurisdiction or template.** | This finding is bounded to the owner-approved shared renderer and current print rule. Recheck the latest reference and two distinct synthetic identifiers. Keep buyer tax snapshots, and request specific owner approval before supporting different jurisdictions or layouts. **A-05**. |
| **The operator is deliberately allowed to edit the recipient. Do you propose weakening that workflow?** | The confirmed fact is that any syntactically valid address is persisted given some valid default. The policy question is how to distinguish a normal edit from an outside-contact exception. Validate how staff need to handle temporary accounts and retain explicit confirmation and audit if exceptions remain. **A-06**. |
| **A unique key already prevents duplicates. Isn't that enough?** | It prevents duplicate rows of the constrained identity, but concurrent callers may get different outcomes. MariaDB can also report transactional conflicts. Test two connections, compare results and error mapping, and distinguish command creation from SMTP delivery. **A-07**, **A-11**. |
| **No tracked CI doesn't mean no CI. Why infer release weakness?** | External CI, infrastructure and deployed versions were unavailable. Request redacted CI and release artifacts for the exact SHA. Historical reports show serious verification effort and count as historical evidence. **A-10**. |
| **Would a rewrite simplify years of conditional policy?** | Rewrites put authoritative finance, mail and identity history at risk. Before reconsidering, measure coordination costs, schema constraints and load. Favor one explicit effective policy and isolated interfaces first. **A-01**, **A-12**, **A-13**, **A-14**. |
| **Could the proposed controls break rollback or suppress authorized work?** | Yes. Rehearse mixed versions and old queue rows with mocks, hold outbound consumers during conversion and verify old document readability. A hard gate without recovery or ownership visibility can strand legitimate work. **A-01**, **A-03**, **A-10**. |

## Questions requiring evidence

1. Which exact release artifact, MariaDB version, and API/worker settings are deployed? Ask for a redacted release inventory or inspect staging only with authorization. Confirm the manual-only cutover with provider spies rather than live transactions.
2. What is the practical revocation requirement for accounting and administrative writes? What happens in the browser when two tabs race refresh/logout? The design and static findings are separable from user acceptance.
3. Who may authorize a newly typed address, and should outbound contact exceptions expire or become persisted channels? How should older replies and unmatched senders appear?
4. How should historical official records with malformed or unreadable QR images be corrected? What trusted artifacts are available to check that a readable image is the externally issued one?
5. What backlog, retry, receipt volume and latency targets reflect real operations? Without them, scalability concerns remain hypotheses and effort estimates stay relative.
6. Do any consumers require the current invoice list fields or legacy bearer access? Inventory clients before narrowing contracts.
7. Are existing accepted cases with missing proposed dates eligible for assisted setup or individual operator review? Define a safe policy before any backfill.
8. Can operations restore MariaDB and the matching encryption key together? What is the rollback decision point after new invoices, payments or messages have been recorded?

## Review order

Begin with [baseline](PROJECT_BASELINE.md), reproduce **A-02** locally, and check the static paths for **A-01**, **A-03**, **A-04**, and **A-05**. Then examine solution costs in the [implementation plan](CODEX_IMPLEMENTATION_PLAN.md). Track disagreements as corrections to evidence, confidence or priorities. Any live tests, migrations, dependency installs, or production access fall under a separately authorized implementation or verification phase.

[Findings](CODEX_INITIAL_REPORT.md) · [Self-criticism](CODEX_SELF_CRITICISM.md)
