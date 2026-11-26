import { jest } from '@jest/globals';
import { MailWorker } from './mail.worker';
import { MailImapWorker } from './mail-imap.worker';
import { MAIL_SEND_JOB } from './mail-queue.constants';
import { IMAP_SYNC_JOB } from './mail-imap-queue.constants';

describe('Deployment maintenance worker hold', () => {
  const paused = { get: () => 'true' } as never;
  it('outbound reminder worker never claims or sends during a hold', async () => {
    const processBatch = jest.fn();
    const worker = new MailWorker({ processBatch } as never, paused);
    expect(await worker.process({ name: MAIL_SEND_JOB } as never)).toMatchObject({ candidates: 0, sent: 0 });
    expect(processBatch).not.toHaveBeenCalled();
  });
  it('inbound and Sent workers do not connect or advance cursors during a hold', async () => {
    const syncAll = jest.fn();
    const syncEnabled = jest.fn();
    const worker = new MailImapWorker({ syncAll } as never, { syncEnabled } as never, paused);
    expect(await worker.process({ name: IMAP_SYNC_JOB } as never)).toMatchObject({ messagesIngested: 0 });
    expect(syncAll).not.toHaveBeenCalled();
    expect(syncEnabled).not.toHaveBeenCalled();
  });
});
