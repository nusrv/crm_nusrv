import { Injectable } from '@nestjs/common';
import type { MailConfiguration } from '../../generated/prisma/client';
import type { MailTransport, PreparedOutboundMessage } from './mail-transport';
import type { MailAcceptance } from './smtp-attempt-policy';

/**
 * No network traffic, ever. Deterministic and safe for tests and non-production defaults. Never
 * reads or decrypts `config`'s credential ciphertext — a mock send has no need for a real secret,
 * so it must never touch one, not even to validate its shape.
 */
@Injectable()
export class MockMailTransport implements MailTransport {
  readonly sent: PreparedOutboundMessage[] = [];

  send(message: PreparedOutboundMessage, _config: MailConfiguration): Promise<MailAcceptance> {
    void _config;
    this.sent.push(message);
    return Promise.resolve({ source: 'mock' });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
