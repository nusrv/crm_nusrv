import { ConfigService } from '@nestjs/config';
import { SecretEncryptionService } from './secret-encryption.service';
import { TechnicalConnectionSecretService } from './technical-connection-secret.service';

describe('Technical connection secret handling', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encryption = new SecretEncryptionService(new ConfigService({ ENCRYPTION_KEY_BASE64: key }));

  it('encrypts with authenticated random envelopes and decrypts the original value', () => {
    const secret = { username: 'integration-user', password: 'never-log-this' };
    const first = encryption.encrypt(secret);
    const second = encryption.encrypt(secret);

    expect(first).not.toEqual(second);
    expect(first).not.toContain(secret.password);
    expect(encryption.decrypt(first)).toEqual(secret);
  });

  it('masks credentials in normal serialized responses', () => {
    const service = new TechnicalConnectionSecretService(encryption);
    const serialized = service.serialize({
      id: 'connection-id',
      code: 'PLESK-TEST',
      name: 'Plesk Test',
      type: 'PLESK',
      endpoint: 'https://plesk.example.test',
      credentialsCiphertext: encryption.encrypt({ apiKey: 'sensitive' }),
      enabled: true,
      environment: 'SANDBOX',
      capabilities: ['READ_STATUS'],
    });

    expect(serialized).not.toHaveProperty('credentialsCiphertext');
    expect(serialized.credentialsConfigured).toBe(true);
    expect(serialized.credentials).toBe('••••••••');
    expect(JSON.stringify(serialized)).not.toContain('sensitive');
  });
});
