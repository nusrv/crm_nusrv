import { Injectable } from '@nestjs/common';
import type { MailConfiguration } from '../../generated/prisma/client';
import { MockMailboxReader } from './mock-mailbox-reader';
import type { MailboxReader, MailboxReaderFactory } from './mailbox-reader';

/**
 * One persistent MockMailboxReader per MailConfiguration id, so a test (or a deliberately mocked
 * non-production default) can seed a specific mailbox's state via `getReaderFor(configId)` before
 * triggering a sync, and different configs never share state — mirroring how two real mailboxes
 * would never share a connection either.
 */
@Injectable()
export class MockMailboxReaderFactory implements MailboxReaderFactory {
  private readonly readers = new Map<string, MockMailboxReader>();

  getReaderFor(mailConfigurationId: string): MockMailboxReader {
    let reader = this.readers.get(mailConfigurationId);
    if (!reader) {
      reader = new MockMailboxReader();
      this.readers.set(mailConfigurationId, reader);
    }
    return reader;
  }

  createReader(config: MailConfiguration): MailboxReader {
    return this.getReaderFor(config.id);
  }

  reset(): void {
    this.readers.clear();
  }
}
