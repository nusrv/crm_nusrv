## 1. Remaining objections

1. **The scope summary still says AI operations are “correctly off.”** That contradicts SC-01. Replace the last sentence of `FINAL_MASTER_PLAN.md:33` with:  
   “The resolver disables operational AI, but eligible historical routing can still write message and thread state. The inspected JoFotara submit route refuses submission. External technical actions remain outside the frozen scope. Cutover and deployed behavior remain unverified.”  
   `ai-routing.service.ts:86–135,310–384`, `invoices.controller.ts:33–40`.

2. **Two lines contradict the agreed sequencing and rollback rules.** Line 48 puts all P0-b work after P0-a, while line 41 allows independent work. Line 51 permits schema-compatible rollback alone, while line 38 also requires policy compatibility. Make these replacements in `FINAL_MASTER_PLAN.md`:
   - **Line 48, first sentence:** “Start independent P0-b fixes in parallel with P0-a. Database-backed acceptance requires the migrated schema and matching Prisma client. P0-c is the coordinated rollout gate.”
   - **Line 51:** “See `ACCEPTANCE_TESTS.md`. Rehearse the cutover and rollback described in P0-c on disposable infrastructure. After owner authorization, stop old consumers before cutover. Pause outbound consumption before rollback and resume only with binaries compatible with both the schema and frozen side-effect policy. Preserve financial and mail records.”

3. **The acceptance checklist still settles or broadens decisions that the plan leaves open.** Replace these lines in `ACCEPTANCE_TESTS.md`:  
   - **Line 10:** “Fulfil UI follows server eligibility and the approved OD-3 invoice prerequisite, if any. Unpaid, partially paid, and paid cases are equally eligible when the other conditions are met. Only an explicit human action commits the tracking date.”  
   - **Line 11:** “A direct dashboard visit with missing access and valid refresh recovers. Verify durable logout revocation and the revocation-write failure path, disabled-user refresh rejection, role reload, and required login at the earlier of configured expiry or the absolute 24-hour cap.”  
   - **Lines 13–14:** “Use seeded pending and abandoned-processing AI decisions to prove zero message/thread writes and zero live provider calls, with audited disposition on cutover. Exercise scan and direct execution. Prove no renewal reminder sends without recorded human approval, internal notification eligibility continues, JoFotara submission is refused, and renewal/payment paths trigger no external technical action.”  
   - **Line 9, append:** “Release a hold and verify delivery when the row becomes due.”  
   `CURRENT_IMPLEMENTATION_SCOPE.md:47–55,179–211,461–473`, `FINAL_MASTER_PLAN.md:38,45,54`.

4. **The finance text still omits a few explicit scope requirements.** Amend `FINAL_MASTER_PLAN.md:40` with these exact replacements:
   - Replace “Company and Individual issuers.” with “Keep `BillingEntity` as the legal issuer for Company and Individual/Personal issuers. Generate System Code and Customer Code Prefix where safe or place them in Advanced/Internal Settings.”
   - Replace “Draft review and DRAFT / NOT OFFICIAL print” with “Draft review and printable/exportable DRAFT / NOT OFFICIAL output without a fabricated official number or QR”.
   - Replace “Exact-decimal payment history, replay without revision churn.” with “Keep exact-decimal payment records linked to invoices, with amount, currency, date, method, reference, notes, recorder, and timestamp. Show unpaid, partially paid, and paid in operational views. Replay leaves the invoice revision unchanged.”
   - Replace “disabled before invoice, enabled once invoice exists” with “visible but disabled before an invoice exists, available once one exists”.  
   Carry these checks into `ACCEPTANCE_TESTS.md:20–22`. `CURRENT_IMPLEMENTATION_SCOPE.md:591–623,679–735,859–919,935–955`.

5. **OD-5 still omits shared versus per-operator unread state.** Replace its entry in `FINAL_MASTER_PLAN.md:54` with: “OD-5 Needs Clarification lifecycle, whether unread state is shared or per operator, and whether Keep in Review clears it.” `ROUND_02_CODEX_RESPONSE.md`, D4.

## 2. Mandatory scope still missing

The remaining explicit omissions are **§13** legal issuer and internal-code handling, **§15** draft export and absence of fabricated official identifiers, **§18** payment record fields and operational statuses, and **§19** receipt-action visibility before an invoice exists. Objection 4 supplies the wording. The other issues are contradictions or acceptance gaps in scope already named in the plan.

## 3. Owner-only confirmation

**Once these document corrections are made, the remaining policy and authorization decisions are owner-only:** OD-1 through OD-12 and authorization to push or deploy. Implementation and runtime acceptance remain engineering work. This round was read-only. No files were modified and no tests were run.