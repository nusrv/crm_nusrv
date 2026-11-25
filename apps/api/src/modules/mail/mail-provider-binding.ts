import { hasAsciiControl } from './mail-ascii-control';
import { createHash } from 'node:crypto';

/** Future durable binding, not the mutable MailConfiguration.updatedAt. */
export interface ProviderBindingSnapshot {
  mailConfigurationId: string;
  generation: string;
  providerNamespace: string;
  providerAccountId: string;
  enabled: boolean;
  observationEnabled: boolean;
}

/** Only an internal adapter that independently verified the account may supply this. */
export interface VerifiedProviderAccount {
  mailConfigurationId: string;
  generation: string;
  providerNamespace: string;
  providerAccountId: string;
}

export type ProviderBindingResult =
  | { outcome: 'UNAVAILABLE' | 'DISABLED' | 'STALE_BINDING' | 'ACCOUNT_MISMATCH' }
  | { outcome: 'BOUND'; binding: { mailConfigurationId: string; sourceBindingKey: string } };

function exactIdentity(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit &&
    value === value.trim() && !hasAsciiControl(value) && !/[\ud800-\udfff]/u.test(value);
}

function validAccount(value: VerifiedProviderAccount | null): value is VerifiedProviderAccount {
  return Boolean(value && exactIdentity(value.mailConfigurationId, 36) &&
    typeof value.generation === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.generation) &&
    typeof value.providerNamespace === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.providerNamespace) &&
    exactIdentity(value.providerAccountId, 512));
}

function sameAccount(a: VerifiedProviderAccount, b: VerifiedProviderAccount): boolean {
  return a.mailConfigurationId === b.mailConfigurationId && a.generation === b.generation &&
    a.providerNamespace === b.providerNamespace && a.providerAccountId === b.providerAccountId;
}

/**
 * Inert guard: compare the captured durable binding with the current locked
 * binding and the independently authenticated adapter account. A configuration
 * ID, host, login name, TLS connection, or MIME sender alone is not evidence
 * of the provider's stable account identity or of an authenticated DSN.
 *
 * Future persistence must allocate a fresh random generation on first binding
 * and invalidate/rotate it atomically on repoint, credential change, disable
 * or re-enable, even if settings later return to the same values. Never use
 * updatedAt as a generation (health/cursor writes also change that field).
 * A missing generation or unavailable account attestation fails closed.
 * This function neither verifies the adapter nor authenticates a report.
 */
export function resolveCurrentProviderBinding(
  captured: ProviderBindingSnapshot | null,
  current: ProviderBindingSnapshot | null,
  verifiedAccount: VerifiedProviderAccount | null,
): ProviderBindingResult {
  if (!validAccount(captured) || !validAccount(current) || !validAccount(verifiedAccount)) {
    return { outcome: 'UNAVAILABLE' };
  }
  if (captured.enabled !== true || captured.observationEnabled !== true ||
      current.enabled !== true || current.observationEnabled !== true) return { outcome: 'DISABLED' };
  if (!sameAccount(captured, current)) return { outcome: 'STALE_BINDING' };
  if (!sameAccount(current, verifiedAccount)) return { outcome: 'ACCOUNT_MISMATCH' };
  const digest = createHash('sha256').update(JSON.stringify([
    current.mailConfigurationId, current.generation, current.providerNamespace, current.providerAccountId,
  ]), 'utf8').digest('hex');
  return { outcome: 'BOUND', binding: {
    mailConfigurationId: current.mailConfigurationId, sourceBindingKey: `provider-binding:v1:${digest}`,
  } };
}
