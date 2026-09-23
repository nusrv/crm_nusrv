import { resolveImapAdapterCapability, resolveSmtpAdapterCapability } from './deployment-mail-capability';

function fakeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

describe('deployment-mail-capability (Phase 3.1 §2C correction)', () => {
  it('resolveSmtpAdapterCapability is REAL unless SMTP_MODE is exactly "mock"', () => {
    expect(resolveSmtpAdapterCapability(fakeConfig({ SMTP_MODE: 'real' }))).toBe('REAL');
    expect(resolveSmtpAdapterCapability(fakeConfig({}))).toBe('REAL');
    expect(resolveSmtpAdapterCapability(fakeConfig({ SMTP_MODE: 'mock' }))).toBe('MOCK');
  });

  it('resolveImapAdapterCapability is REAL unless IMAP_MODE is exactly "mock"', () => {
    expect(resolveImapAdapterCapability(fakeConfig({ IMAP_MODE: 'real' }))).toBe('REAL');
    expect(resolveImapAdapterCapability(fakeConfig({}))).toBe('REAL');
    expect(resolveImapAdapterCapability(fakeConfig({ IMAP_MODE: 'mock' }))).toBe('MOCK');
  });

  it('regression — MAIL_SEND_ENABLED/IMAP_SYNC_ENABLED have no effect on either capability, however they are set', () => {
    expect(resolveSmtpAdapterCapability(fakeConfig({ MAIL_SEND_ENABLED: 'false' }))).toBe('REAL');
    expect(resolveSmtpAdapterCapability(fakeConfig({ MAIL_SEND_ENABLED: 'true', SMTP_MODE: 'mock' }))).toBe('MOCK');
    expect(resolveImapAdapterCapability(fakeConfig({ IMAP_SYNC_ENABLED: 'false' }))).toBe('REAL');
    expect(resolveImapAdapterCapability(fakeConfig({ IMAP_SYNC_ENABLED: 'true', IMAP_MODE: 'mock' }))).toBe('MOCK');
  });
});
