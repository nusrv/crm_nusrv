# ACCEPTANCE CRITERIA (none executed; "static" = verified by reading, "runtime" = must be executed in a later authorized stage). Codex review PENDING.

| OD | Criteria | Verification |
|---|---|---|
| 1 | Free-text recipient rejected by API; only active valid registered contact of the case's customer accepted; default BILLING→PRIMARY→primary email; TECHNICAL/MANAGEMENT only if explicitly chosen; contact deactivated before first attempt → cancelled+audited; no contact → warning with link | runtime unit+integration |
| 2 | Disabled user, downgraded role, revoked session rejected on every inventoried sensitive route with a still-valid access token; ordinary GETs perform no extra DB check (query-count test); logout durable even if a write fails is reported; refresh unchanged | runtime |
| 3 | Fulfil returns 409 with draft-only or none; succeeds with official-recorded linked invoice regardless of unpaid/partial/paid; payment tables never read; UI matches; tracking date committed only by human action | runtime |
| 4 | Payment on draft/ready/official non-cancelled invoice recorded (per Q1); overpayment rejected; replay leaves invoice revision unchanged; receipt create blocked until invoice official; receipt shows invoice number; two payments → two receipts, same visible number, distinct ids; manager void/replace keeps prior snapshots, reason, actor; non-manager rejected; payment row unchanged by receipt correction; no invoice payment info on invoice PDF | runtime |
| 5 | Clarification draft ≠ sent; case moves to Waiting for Customer only after send success, same transaction; failed/uncertain send leaves HUMAN_REVIEW; Keep in Review marks read, keeps case in review, audited, no approval; read-state shared; "awaiting decision" shown independently | runtime |
| 6 | Active hold + human send → sent; scheduled customer rows still cancelled; engine produces no customer sends | runtime |
| 7 | Read-only inventory lists affected cases without writes; manager endpoint validates dates, requires reason, audits, never changes subscription date; non-manager rejected | runtime |
| 8 | Truncated/corrupt/oversize PNG,JPEG,WebP structurally rejected; valid files accepted; limits documented; QR not decoded; correction keeps original+replacement+actor+time; invoice values/number unchanged; print uses latest correction | runtime |
| 9 | After browser restart within 24h dashboard recovers via session-restore; after logout/disable/expiry goes to login; no long-lived access token | runtime browser |
| 10 | Label "Deferred — Currently Inactive"; provider test buttons disabled; seeded historical AI decisions cause zero writes/provider calls | runtime |
| 11 | Company template matches NUSRV reference at A4; issuer vs customer distinct-tax fixture shows issuer; no extra issuer line; Individual print blocked until reference approved | runtime + visual |
| 12 | SMTP result stored; Sent-folder match by Message-ID sets observed event; DSN failure → Failed/Bounced and never creates a customer reply; no delivered/read claim without evidence; crash-after-attempt and post-DATA timeout → Uncertain with no automatic retry/resend; manager resend is explicit and audited; sync idempotent across UIDVALIDITY change | runtime with fake SMTP/IMAP |

Static status today: none of the above is implemented; findings in `OWNER_DECISION_TRACEABILITY_MATRIX.md` are source-reading only.
