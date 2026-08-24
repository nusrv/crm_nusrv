import { Global, Module } from '@nestjs/common';
import { SecretEncryptionService } from './secret-encryption.service';
import { TechnicalConnectionSecretService } from './technical-connection-secret.service';

@Global()
@Module({
  providers: [SecretEncryptionService, TechnicalConnectionSecretService],
  exports: [SecretEncryptionService, TechnicalConnectionSecretService],
})
export class SecurityModule {}
