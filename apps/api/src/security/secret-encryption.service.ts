import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ENVELOPE_VERSION = 'v1';
const MASKED_SECRET = '••••••••';

@Injectable()
export class SecretEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY_BASE64'), 'base64');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.');
    }
  }

  encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      iv.toString('base64url'),
      authenticationTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt<T>(envelope: string): T {
    const [version, ivValue, tagValue, ciphertextValue] = envelope.split('.');
    if (version !== ENVELOPE_VERSION || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('Unsupported encrypted secret envelope.');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }

  mask(hasValue: boolean): string | null {
    return hasValue ? MASKED_SECRET : null;
  }
}
