/** Slice D hardening pass — explicit provider call timeout, never the SDK's undocumented default
 * (same rationale as Slice B/C's SMTP/IMAP timing constants). A single intent classification is a
 * small, bounded request/response, but 30s proved too tight a margin under real network/provider
 * queueing latency; 60s stays comfortably under the 120s ceiling this repository's AI strategy
 * allows while giving real-world headroom. A timeout here is always treated as a transient
 * provider/infrastructure failure (see openai-llm-gateway.ts's toLlmError()), so it simply consumes
 * one BullMQ retry attempt rather than ever failing the message outright. */
export const AI_PROVIDER_TIMEOUT_MS = 60_000;

/** Explicit upper bound on generated output tokens for one classification. The normalized result is
 * tiny (intent enum, confidence, a boolean, a short summary, a language code, a schema-version tag)
 * — this exists purely to prevent an unexpectedly large/runaway generation, never to accommodate a
 * legitimately large response. */
export const AI_MAX_OUTPUT_TOKENS = 600;

/** Bounded recovery-scan batch size (§11/§30) — never an unbounded table scan. */
export const AI_RECOVERY_SCAN_BATCH_SIZE = 100;

/** Recovery scan interval — mirrors Slice C's IMAP 5-minute cadence. */
export const AI_RECOVERY_SCAN_INTERVAL_MS = 5 * 60 * 1000;

/** Slice F — a suggested reply is a short multi-paragraph email, legitimately longer than
 * classification's tiny structured result, but still explicitly bounded rather than left to an
 * undocumented provider default. */
export const AI_DRAFT_MAX_OUTPUT_TOKENS = 900;
