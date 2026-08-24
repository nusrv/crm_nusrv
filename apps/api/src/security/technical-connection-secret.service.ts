import { Injectable } from '@nestjs/common';
import { SecretEncryptionService } from './secret-encryption.service';

export interface TechnicalConnectionRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  endpoint: string | null;
  credentialsCiphertext: string | null;
  enabled: boolean;
  environment: string;
  capabilities: unknown;
}

@Injectable()
export class TechnicalConnectionSecretService {
  constructor(private readonly encryption: SecretEncryptionService) {}

  encryptCredentials(credentials: Record<string, string>): string {
    return this.encryption.encrypt(credentials);
  }

  decryptCredentials(ciphertext: string): Record<string, string> {
    return this.encryption.decrypt<Record<string, string>>(ciphertext);
  }

  serialize(record: TechnicalConnectionRecord): Omit<
    TechnicalConnectionRecord,
    'credentialsCiphertext'
  > & {
    credentials: string | null;
    credentialsConfigured: boolean;
  } {
    const { credentialsCiphertext, ...safe } = record;
    const credentialsConfigured = Boolean(credentialsCiphertext);
    return {
      ...safe,
      credentials: this.encryption.mask(credentialsConfigured),
      credentialsConfigured,
    };
  }
}
