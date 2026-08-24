# ADR-002 — Phase 0 Foundation Decisions

## Status

Accepted

## Decisions

- Use npm workspaces without Nx or Turborepo; the current repository does not need another build
  graph layer.
- Keep one Prisma schema at `apps/api/prisma/schema.prisma`. ADR-003 supersedes the original
  database-native mapping decision: Prisma uses the `mysql` provider, UUID strings use
  `VARCHAR(36)`, IP text uses `VARCHAR(45)`, and logical JSON/decimal/date behavior is preserved.
- Prevent duplicate renewal cycles with a database unique key on subscription and due date. No
  scheduler or transition logic is implemented in Phase 0.
- Model users, roles, refresh sessions, and MFA methods now because they are required security
  foundations. MFA enrollment and challenge completion remain deferred.
- Use short-lived JWT access cookies plus hashed, revocable refresh sessions. Cookies are HTTP-only,
  SameSite, secure in production, and mutations enforce the configured web origin.
- Apply account lockout after five failed password attempts and require CAPTCHA before checking a
  password. CAPTCHA has a non-production mock and fail-closed provider verification.
- Encrypt technical-connection credentials with AES-256-GCM. Each value uses a random nonce and
  versioned envelope. Normal serializers expose only a mask and configured/not-configured flag.
- Make audit events append-only through the service API and MariaDB `BEFORE UPDATE` /
  `BEFORE DELETE` triggers that reject mutations with SQLSTATE `45000`. Sensitive audit fields are recursively redacted before persistence.
- Configure BullMQ globally but register no queues or jobs until their owning business phase.
- Default every future external integration to mock mode. Phase 0 includes no mail, AI, Fawtara,
  Plesk, SmarterMail, renewal, collection, retention, suspension, or reactivation execution.

## Consequences

Critical business state changes added in later phases must use application/workflow services,
transactions, audit writes, role guards, and adapter boundaries already established here. The Phase 0
frontend proves authentication and role-aware navigation only; it is not a CRUD application.
