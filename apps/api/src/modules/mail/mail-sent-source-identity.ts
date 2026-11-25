import { createHash } from 'node:crypto';
import { computeImapIdentityKey } from './imap-identity.util';

export function sentSourceIdentity(input: { mailConfigurationId: string; canonicalFolder: string; uidValidity: bigint; uid: bigint; connectionGeneration?: string }): string {
  const generation = input.connectionGeneration ?? 'legacy';
  if (generation === 'legacy') return computeImapIdentityKey(input);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation)) throw new Error('Invalid Sent connection generation');
  return 'v2:' + createHash('sha256').update(JSON.stringify([input.mailConfigurationId, generation, input.canonicalFolder, input.uidValidity.toString(), input.uid.toString()])).digest('hex');
}
