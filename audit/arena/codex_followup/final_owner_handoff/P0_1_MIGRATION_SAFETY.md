# P0.1 baseline and migration safety

P0.1 is locally implemented and statically checked. Completion for rollout requires authorized environment evidence and a disposable MariaDB rehearsal. The starting branch was `main` at `32013c24488b6ea68c7e886a779f0801727aae54`. The working tree contained 15 modified tracked files and 66 untracked files, with no staged changes. The exact baseline and file hashes appear below.

## Implemented and deferred schema changes

| Existing Prisma mapping | Checked-in SQL before P0.1 | P0.1 disposition |
| --- | --- | --- |
| `RenewalCase.proposedPeriodStart/End` and `proposedNextRenewalDate` | Table and primary key in `20260823000000`. Proposed columns absent. | Added three nullable DATE columns. Legacy proposed dates remain unknown. |
| `CommunicationOutbox.manualApprovedBy` | Table in `20260824000000`. Marker absent. | Added nullable VARCHAR(36). Existing messages gain no approval. |
| `EmailMessage.reviewedAt/By` | Table in `20260910000000`. Review fields absent. | Added nullable DATETIME(3) and VARCHAR(36). No historical review inferred. |
| `Invoice.sourceRenewalCaseId` | Table in `20261117000000`. Link absent. Both PKs are VARCHAR(36) with matching utf8mb4_unicode_ci table defaults. | Added a nullable VARCHAR(36), ordinary index and RESTRICT delete/CASCADE update FK. Existing rows remain unlinked. Association eligibility and uniqueness for a qualifying official invoice stay with P1.1 and its owner gates. |
| `Invoice.customerId` and `sourceSubscriptionId` | Both NOT NULL with named restrictive FKs in `20261117000000`. | Leave the database constraints in place. Draft edit/return helpers still expect a subscription ID, and the draft key would collide for unattached invoices. Verify physical FKs/indexes and make draft handling safe in P1.1 before relaxing. |
| `Payment` and `PaymentReceipt` | Tables absent from the 16 original migration files. | Leave finance DDL gated pending evidence of actual table shape/data and the approved P1.2 collection contract. The dirty receipt path can expose the old role and balance behavior if the tables are provisioned under the current binary. |

The migration order is the existing 16 files, then `20261122000000_p01_nullable_renewal_and_communication_metadata`, then `20261122001000_p01_optional_invoice_renewal_source`. Neither new file uses DML, defaults that fabricate state, or backfills. No prior migration, Prisma mapping or runtime source was edited. The existing draft financial and renewal code is unreleased as part of this change. Its case list/detail includes linked invoices and nested payments, so applying only these migrations is insufficient to run that dirty binary safely. Future link activation must also handle customer and subscription deletion paths that currently only pre-check direct invoice references.

The tracked deploy command is Prisma migrate deploy. The repository MariaDB integration runner has an explicit Jest spec list ending at Slice E, while some of those suites load all SQL files. The omission of later test specs does not establish that deployed databases skipped their SQL. Deployment state for Slice G, settings, invoicing, Phase 4B and branding remains unverified.

## Verification performed

- `node --test apps/api/prisma/p01-additive-migrations.test.mjs` on Node v26.13.0 passed all four isolated, file-only checks. They cover dependency and PK ordering, exact nullable metadata DDL, exact link constraints, and correspondence with the current Prisma declarations.
- `git diff --check` passed. The final status, baseline file hashes and historical migration hashes were compared.
- Prisma CLI and Jest dependencies are absent locally. No running disposable MariaDB instance was identified, and the local Docker service was stopped. No database command, query, migration execution, backup or restore rehearsal was performed. The static check does not establish successful SQL execution.
- Delegation used `routine_low` for SQL history and runner inventory and `design_medium` for application dependencies. Each delivered its distinct read-only review. No fallback or high-effort subagent was used.

## Environment approval and rollout gates

1. Obtain separately authorized read-only schema and migration evidence. Capture MariaDB version and storage engine, `_prisma_migrations` names/checksums/completion and any failed or rolled-back entries, and the actual tables, keys, collations and type/nullable definitions for `renewal_cases`, `communication_outbox`, `email_messages`, `invoices`, and any payment/receipt tables. Check for conflicting same-name columns or constraints. Verify the matching FK column types, collations and supporting parent key and inspect table size and expected lock impact. Compare data counts and exception counts without inferring legacy dates, approvals, reviews or invoice links. Prefer operator-supplied metadata over network access from this workspace.
2. Authorize an explicitly disposable MariaDB target with test-only credentials. Rehearse the full checked-in chain on a fresh schema and an upgrade from a verified compatible pre-P0.1 baseline. Check old inserts with explicit column lists, null defaults on existing fixtures, no changed historic values, FK rejection for an unknown case, key updates, RESTRICT behavior and repeat deployment bookkeeping. Verify backup and restore on the disposable target and confirm expected DDL lock and interruption behavior.
3. Resolve real drift before any target apply. Leave both migrations pending if predecessors or physical prerequisites are missing, or if columns or link constraints already exist outside history. Compare definitions and checksums and document the reconciliation path. If an ALTER succeeds and a later ALTER fails, inspect each statement's effect before repairing history. MariaDB DDL can commit outside the migration's logical unit. Reapplying a partially applied file blindly can fail or obscure drift.
4. Use separate approval for operational application of either migration. Keep the old compatible binary or safely gated paths through schema expansion. Do not enable any of the dirty runtime's financial, fulfillment, or outbound behavior as part of P0.1. New payment tables, invoice FK relaxation, and link-writing paths require their own approved slice and relevant evidence. The next independent implementation candidate is P0.2, both-outbox uncertain-send replay containment, after explicit authorization. No wider scheduling change belongs in that first safety step.

## Starting Git status and SHA-256

Each line records the original `git status --porcelain=v1 --untracked-files=all` entry followed by its file's SHA-256. Final status has the same entries plus the tracked project-status update and four untracked P0.1 additions.

```text
 M .env.example  C3F10636B83AE0C04D170122C3126E1E563FBBE49C3596A8EE70121B2E1D4E13
 M apps/api/prisma/schema.prisma  457B52BA7EEE565598173DEA7613766F1D3BF8B296F8E8C2BB9FD8CA5253C17F
 M apps/api/src/config/environment.ts  C601FF53891DB1033452DF5ACDA9D8FE48CBB7549E0E322B43AECE6913A657A7
 M apps/api/src/identity/auth.service.ts  1242F8E47B9F27FA7E31FC0227CD4DFD4E3F67B9B9D67F3172E3029A898E2949
 M apps/api/src/modules/ai/ai-settings-resolver.service.ts  3E7E479E50D0A50A3371B84D0019A4C81A1D76604A81A0810513999714EA253D
 M apps/api/src/modules/invoices/invoices.controller.ts  BB4C9B635FA73B220E12D3FA994FB7672E3EC8B68F3829316074D439BD473791
 M apps/api/src/modules/invoices/invoices.module.ts  65C900E06BEC9CF85FBCB69FCE54BFACF7CB7B773525D4FF09ACE8083B5A1048
 M apps/api/src/modules/invoices/invoices.service.ts  227F3157BC3AD76C7DDF09BF77B564294F7572FE5A49FB39C41FFB06B00E7BCB
 M apps/api/src/modules/mail/mail-outbound.service.ts  66FE6A079AC597B013F83D2EF87A1DBE965EC60FCF9C6F2D524BC7BCC99347E6
 M apps/api/src/modules/renewal-cases/renewal-cases.controller.ts  D64384D3E6A314889DF696CFACF85A144AFA2C1A901FE0683B60CA8B501D96C7
 M apps/api/src/modules/renewal-cases/renewal-cases.module.ts  717959B7F549C1AD58632C48268239F3B15886903A0285819998FB8CF0809705
 M apps/api/src/modules/renewal-cases/renewal-cases.service.ts  648D0E9F2DB49F9237EEE23F30CE09C3502D5D676D20058227E8F330355D8F41
 M apps/api/src/modules/renewal-cases/renewal-engine.service.ts  885F0AE13A83662F943FAA17C6C81C7BDC3235253FB1C1D31D0DFA9790D7FC7B
 M apps/api/src/modules/renewal-cases/renewal-transition-policy.ts  529FB57A690DAE5999A31AB99F1EEFD15625B178850C4AA00F44A109E3BB176F
 M apps/web/lib/api.ts  F80608E8CE2CD61B695AF1A9A09A4398EC578B9842C0913DC637E0F9A033476A
?? apps/api/src/modules/invoices/payment-money.ts  6155A24FDEAAACE7F2422D45D47138853C4E73F6B31EA2503A2DD7D9B942697E
?? apps/api/src/modules/invoices/payments.controller.ts  A7219FE4252C2506050B46857702888771C7EEA4BF7CDE1E86FED69B608D4D82
?? apps/api/src/modules/invoices/payments.service.ts  EB4CDD7A91BEDB954428C6147062160B6A4662F527002B14CC4EACF72D2C66BB
?? apps/api/src/modules/renewal-cases/manual-renewal.service.ts  8783CFDB19659678C95898359CE56D7E6FC77BED22809D4C1758A9A9ED794896
?? apps/api/src/modules/renewal-cases/renewal-period.ts  C5C7DD5DDCF039DC15DC5E9556467F02BFF3A10E98EE30DAEB0BF1D91D45D6D0
?? audit/CODEX_CHALLENGE_READINESS.md  7D89843D8DA2A47806106DE7A4C528DA26AF39695C115B2B0FCAC81808D1CBA8
?? audit/CODEX_FUTURE_VISION.md  4364E390EB5FC001E34B407A6E08CEEB924EA741DFA5D678837BE51F9EA8D5C0
?? audit/CODEX_IMPLEMENTATION_PLAN.md  332A1826286A6AF6C48BBF7ED0B5C47CC08D0259325A90D011FAEC10CD73B484
?? audit/CODEX_INITIAL_REPORT.md  B089538270CFB638A3CCE3F7BC6D99962AC5CFB4698E0B2D48A988DE40CABB6C
?? audit/CODEX_SELF_CRITICISM.md  124C813E376AE2BDC128B374BEA0EF55C35A3DE8C11589FC9FC56B7E65B6B936
?? audit/PROJECT_BASELINE.md  230F2667AAC33113715BE4881228A7175B31BFFF3EEE625F875A0AD625BEF289
?? audit/REPOSITORY_COVERAGE_REPORT.md  C7ED91575575AB0F91E2F9A23594ACB1DC118241B5776E201D0C519FF4B7448D
?? audit/SCOPE_COMPLIANCE_MATRIX.md  E7B7C48775D80F45A1FCE92DBC5AED5AF6D487DECC54FC913B1ED23102FB250B
?? audit/arena/.baseline_diff_sha.txt  BCB2323DBF9F09C203DC054A85FD8673A5C0D7B2330EBC65BB4991643AC865AA
?? audit/arena/.baseline_file_hashes.txt  A13FD4C33ECCD57FA7419AA41350E57E5597631B7B90B64B924EBB009D80D344
?? audit/arena/.baseline_head.txt  BCCEAEF481ADE19AD6A20B1F392A15109A399AD88381DCC03B444F3CD77F6A69
?? audit/arena/.baseline_status_before.txt  4D14E046677435051AD4937A9A1206E32D7DCF7EB93F64D201EA8B3F2F1DE9EE
?? audit/arena/ACCEPTANCE_TESTS.md  CE6CCF7BC60C0965336D9AC1EB303413A78BCE9301179B632957294A987B8E32
?? audit/arena/CLAUDE_INDEPENDENT_REVIEW.md  33AB36E0CE79AD32A6B269D8ABD0F48B3D6F78B3292A96E5DA8DB26D8F47CC4E
?? audit/arena/CLAUDE_INITIAL_CHALLENGES.md  272A35559D187691B66C25DD55823182A0D22CCAD79904782324F956B9ADDD02
?? audit/arena/DEBATE_LEDGER.md  232928D636EDE26A4BF8FBE3D5DCC516B2A3B042788BE7204743662F390E825C
?? audit/arena/FINAL_MASTER_PLAN.md  6E78400560D00D906E65127A10F7AED9266E51DC4C353269F503B64C6551EA0E
?? audit/arena/FINAL_VERDICT.md  C4141107E0E9E52AC1C00471EEF1EFA2662500EACA514B371DC9580648E84E82
?? audit/arena/IMPLEMENTATION_ROADMAP.md  DBC8507D71B064FF6EAEB482060FADF0BF607801C6A4147AC9139BCB45F2BB03
?? audit/arena/OWNER_DECISION_BRIEF.md  EDCC6F45B8531699F260CF2603C8A8EACCB50ED1C11FBCDC7BB48CA7B76EC072
?? audit/arena/SCOPE_COMPLIANCE_VERDICT.md  68FD88E92DAA1242F4BA001FCF87608184111CD8B60E068133594E946B25F7B0
?? audit/arena/SESSION_STATE.json  1422F41D54D7C1D670EC92BB5B87CF86BE62A6BF3F5BA099F100766FB84FBB1F
?? audit/arena/UNRESOLVED_DISAGREEMENTS.md  8DDF84541481D569D0A132E903A1F88B6D1A2501F16AF9733F14CE00586ACC15
?? audit/arena/VERIFIED_FINDINGS.md  829784235BB70CD87C89610E2EAE8E5979011129D76EF798672E591DAB163C1E
?? audit/arena/codex_followup/CODEX_REVIEW_OF_CLAUDE.md  76FE6CA44AD23C6401E5E65C31CC97E9A488C6515F1AB3C3D1D88152582AE485
?? audit/arena/codex_followup/CODEX_TECHNICAL_VERDICT.md  257ED85FE53514ACA74ACF0D27D345531650873DB0AAE8D4C4CEA47D85D2FEEB
?? audit/arena/codex_followup/OWNER_DECISION_GAPS.md  5F1BB8BDB3E66BE122FEF4DF9FA29B305DC46308DDC1AF3000145C037513148D
?? audit/arena/codex_followup/P0_IMPLEMENTATION_READINESS.md  3C5F90C3DED9528A13ADC0667CE55A90FCE44BFBF78888CEBB025D1719497DD1
?? audit/arena/codex_followup/PROPOSED_ROADMAP_CORRECTIONS.md  E293AEA2A4B9294030C6784853A27CD2FE473B4088D6EBF44B47329983C94FF9
?? audit/arena/codex_followup/final_owner_handoff/APPROVED_OWNER_REQUIREMENTS.md  89BB241D69016B621C2A9B53728789F2550F8B874F1DD0BA5C52F2FD8C1479A3
?? audit/arena/codex_followup/final_owner_handoff/BASELINE_AND_SAFETY_REPORT.md  04A4173D764405D843A7A9557A791BFEA4244D8214ADDCE9B8EC719218AB8502
?? audit/arena/codex_followup/final_owner_handoff/FINAL_IMPLEMENTATION_ROADMAP.md  DB7515F4802FF369293DA6BE53E0387113E146463C2F3A9A02B1A4CC79C1B6BB
?? audit/arena/codex_followup/final_owner_handoff/FINAL_TECHNICAL_DESIGN.md  18A04C5F4AF0EDD0F792134D654DD43743D45F7D7498D2D486BCD93CE00E598C
?? audit/arena/codex_followup/final_owner_handoff/IMPLEMENTATION_ACCEPTANCE_TESTS.md  7E6F2FB4EF25AEA5B90644AFD5A2684CDFA9726554FAB339385C500FEEEF52DD
?? audit/arena/codex_followup/final_owner_handoff/OWNER_APPROVAL_GATES.md  802AB52A502B1FE602E0ED683EA5952234F37C555FA58E51516A3C50CD28BD8D
?? audit/arena/owner_reconciliation/.baseline_hashes.txt  A13FD4C33ECCD57FA7419AA41350E57E5597631B7B90B64B924EBB009D80D344
?? audit/arena/owner_reconciliation/.baseline_head.txt  BCCEAEF481ADE19AD6A20B1F392A15109A399AD88381DCC03B444F3CD77F6A69
?? audit/arena/owner_reconciliation/.baseline_status.txt  4D14E046677435051AD4937A9A1206E32D7DCF7EB93F64D201EA8B3F2F1DE9EE
?? audit/arena/owner_reconciliation/ACCEPTANCE_CRITERIA.md  A0B819AB77BD49CE5301643B29B17AB0E63BD4FC3EB50E3174091FE80BFA1AD4
?? audit/arena/owner_reconciliation/CLAUDE_CODEX_RECONCILIATION_LOG.md  03E0D79E9E1C2F3D5A216794232CED0F690377486616E6E9A7A4040BFD879C42
?? audit/arena/owner_reconciliation/CLAUDE_INTERPRETATION_R1.md  7709D73DC5171D4DDE91819D95398A8633A46098005DE79A88EF033B9F1C12FA
?? audit/arena/owner_reconciliation/FINAL_ENGINEERING_SPECIFICATION.md  3E804929CB1EDFEAE971CB3CF1646A077B536D56EE4AA82CDAFD798C35F83C31
?? audit/arena/owner_reconciliation/FINAL_RECONCILIATION_VERDICT.md  0FB65863064F38E5C0BF834AA873161D8EB87ED80C1745D7270BC484378475EE
?? audit/arena/owner_reconciliation/OWNER_CLARIFICATIONS_REQUIRED.md  225D07D2A2A8763D4BF25A5F6B79F31FFAEB6417CE95B2E87C74D4030B5D2B93
?? audit/arena/owner_reconciliation/OWNER_DECISIONS_APPROVED.md  5F1763AF04B375CF263688E874892B698626AF1A2CEF09FE3A21772D31148D10
?? audit/arena/owner_reconciliation/OWNER_DECISION_TRACEABILITY_MATRIX.md  88E4B9BC9406829E49E7E186BED8E593A83315C7D4C212701FD7747A4CF52143
?? audit/arena/owner_reconciliation/REVISED_FINAL_MASTER_PLAN.md  9077E56EAA1112AC2BA910305B239FB92035CC703A75F4A7B2BC06051EFEFF19
?? audit/arena/owner_reconciliation/codex_responses/ROUND_01_CLAUDE.md  5D9691DF5C770EFAFC491B7303A9A347180B846A83A1A81ED78991884B1048CF
?? audit/arena/owner_reconciliation/codex_responses/ROUND_01_CODEX.md  E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
?? audit/arena/rounds/ROUND_01_CLAUDE_MESSAGE.md  73CC143A4EA147E428686FA1186CD625AD9BE4BC1F35C7FE27E6B3F7DDC26A5A
?? audit/arena/rounds/ROUND_01_CODEX_RESPONSE.md  A23D09506A457D58BCC72C7A0A3C7E94B50AD87ADE9C78D166A48B807645A6DA
?? audit/arena/rounds/ROUND_02_CLAUDE_MESSAGE.md  417D6B3E358EA4E101DD5A086FABC3E67733FE0F4BFB371E72E5BB5CF3A874AE
?? audit/arena/rounds/ROUND_02_CODEX_RESPONSE.md  874B574473AB1D5E506FE2C38499C3FFE98D3B06653F60E2D5E25C784A75CEA2
?? audit/arena/rounds/ROUND_03_CLAUDE_MESSAGE.md  C5D82053C77EA7B195147BF70BC2382646AB72A03CA0A8A5D6ADC5C6297504CE
?? audit/arena/rounds/ROUND_03_CODEX_RESPONSE.md  F0C21D1247F900547B4C248B274C68ED64C47F9C5B2E542B551D4DE7D357BA4B
?? audit/arena/rounds/ROUND_04_CLAUDE_MESSAGE.md  BC258CABA6B2AE8FA54775185E8FF6B0DB212EBD0B63D468608ED6E984B80173
?? audit/arena/rounds/ROUND_04_CODEX_RESPONSE.md  26D6853BD884EF6BF9954633F6BCE92C3BBC313D064407F6CC78D8345BB91507
?? audit/arena/rounds/ROUND_05_CLAUDE_MESSAGE.md  DD85839B42CB0278E5CAFAC781F8E593B2349CF4D4C77737378A37DED1ADC073
?? audit/arena/rounds/ROUND_05_CODEX_RESPONSE.md  84C9B4F84DA57CFB906A366E5CFECCE54D1C45A1EC2BE05332AFFF2A9085DB5B
?? docs/CURRENT_IMPLEMENTATION_SCOPE.md  58DFE24B7D2A8A0907DA18D9D8C458A9D51FBD23180E58B649A25F9BA205D12C
?? docs/templates/nusrv_invoice_latest_reference.pdf  0C0E9333165F09EE26865ACE3EAB884A0E46FFB7BA054A101DA0F8E6FBEB2FAA
```

## Starting checksums for migration history

These SHA-256 values record the working bytes of the existing SQL files and lock file for before/after comparison.

```text
D5BA63823E7C6CD1E6E41AABCA3092CAD1D2AE5069490BFF0FD915AE912AD67A apps/api/prisma/migrations/20260823000000_mariadb_phase_0_1_foundation/migration.sql
2BC30BAD02196EFF69F72DA49218E0F7623919859B9A205644EF6D59865EBDBD apps/api/prisma/migrations/20260824000000_phase_2_renewal_engine/migration.sql
CC268BF5BDFBB7CB4D3A435C9C1224F1CC12EDAC82421BE74B0EAA2BE171CA66 apps/api/prisma/migrations/20260827000000_phase_2_1_operational_data/migration.sql
E29DFC717B983C4F6DAEF3C160C423C210AD567C1D358EDF8F2EF2AE86670CBA apps/api/prisma/migrations/20260827010000_scope_legacy_import_active_sheet/migration.sql
E7EF18870599A01E1D5C1227B6E999C951545F628ABD060E2ACABE05D9BD0F14 apps/api/prisma/migrations/20260831000000_currency_and_contact_channels/migration.sql
59B237F2CA1656C81119F940327AEE3F8E9DE69A1891435670C02360E49BB1EA apps/api/prisma/migrations/20260906000000_canonical_phone_contact_and_source_order/migration.sql
8F524FCA1A9A8BE9985AA356F386704EF34976D882D2338E2E19E955AB4E1DE4 apps/api/prisma/migrations/20260908000000_customer_code_sequences_and_bilingual_names/migration.sql
06E838ADF9C1FBA59A61DF647EA9CB3FD9F2372DD727CD4FEAF3554D02319FA1 apps/api/prisma/migrations/20260909000000_subscription_code_sequences_and_backfill/migration.sql
9E99C5361593A2924EF30BFF45ADC3E31567A41C7356C7B1A19AC4A9CC16D55B apps/api/prisma/migrations/20260910000000_phase3_slice_a_communication_domain/migration.sql
33C601DB30D756555A41A73B53429E56BD05CC33A75B87D075AEBEAED1C84CE7 apps/api/prisma/migrations/20260917000000_phase3_slice_e_operator_reply_outbox/migration.sql
2895D8BABCE7C44285CD7703053AEAE3F511E8A801BD042502A49CEB89778BCC apps/api/prisma/migrations/20260921000000_phase3_slice_g_ai_routing_decision/migration.sql
2C5CD97142C161D66B983FFFEB662038626BCBE1FC4E975DCDA4F088AC0C54A1 apps/api/prisma/migrations/20260923000000_phase3_1_admin_settings/migration.sql
7F33FF51A97532414F748676C8EDA82F094FD253E7B07C9471EF67AA0B8A88B4 apps/api/prisma/migrations/20261117000000_phase4a_manual_invoice_foundation/migration.sql
610B4605C2543BC2FFC72B15FD7B979E5AC2E3B988A83FE0983460895558C1F0 apps/api/prisma/migrations/20261118000000_phase4a_invoice_hardening/migration.sql
580C3070D995B6AB8E9DCD3041EAFA211E28E7909E0D93336743D8FF4C6F430C apps/api/prisma/migrations/20261118010000_phase4b_jofotara_connections_submissions/migration.sql
FCFD8BF883050AB63573CEE4925778BA3F310FC4D9BE5F82C33EB146E57E4E62 apps/api/prisma/migrations/20261118020000_multi_issuer_invoice_branding/migration.sql
0F4CBFA4BAC3B634D4C728DCF2637C5F1D64882515BCD923AF1A8A6EBCF057DD apps/api/prisma/migrations/migration_lock.toml
```
