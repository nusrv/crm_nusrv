import { Injectable } from '@nestjs/common';
import type { MailConfiguration } from '../../generated/prisma/client';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { ImapMailboxReader } from './imap-mailbox-reader';
import type { MailboxReader, MailboxReaderFactory } from './mailbox-reader';

/** A fresh ImapMailboxReader (and therefore a fresh IMAP connection) per config per sync attempt —
 * never pooled/reused, matching ImapMailboxReader's own documented scope. */
@Injectable()
export class ImapMailboxReaderFactory implements MailboxReaderFactory {
  constructor(private readonly encryption: SecretEncryptionService) {}

  createReader(config: MailConfiguration): MailboxReader {
    return new ImapMailboxReader(config, this.encryption);
  }
}
