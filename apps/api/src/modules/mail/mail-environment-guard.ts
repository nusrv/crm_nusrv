import type { IntegrationEnvironment } from '../../generated/prisma/enums';

/**
 * Fail-closed environment guard (Slice B hardening pass). Strict 1:1 pairing, no permissive
 * fallback in either direction:
 *   - NODE_ENV=production      -> only a PRODUCTION-scoped MailConfiguration is usable.
 *   - NODE_ENV != production   -> only a SANDBOX-scoped MailConfiguration is usable.
 * A production process must never fall back to sending real mail through a SANDBOX
 * configuration, and a non-production process (dev/test/staging) must never be able to reach a
 * PRODUCTION-scoped configuration even if one happens to exist in a shared database.
 */
export function isMailConfigEnvironmentAllowed(
  configEnvironment: IntegrationEnvironment,
  nodeEnv: string,
): boolean {
  if (nodeEnv === 'production') return configEnvironment === 'PRODUCTION';
  return configEnvironment === 'SANDBOX';
}
