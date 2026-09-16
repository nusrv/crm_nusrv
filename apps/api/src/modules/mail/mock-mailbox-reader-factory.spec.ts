import { MockMailboxReaderFactory } from './mock-mailbox-reader-factory';

function fakeConfig(id: string): { id: string } {
  return { id };
}

describe('MockMailboxReaderFactory', () => {
  it('returns the same reader instance for the same MailConfiguration id', () => {
    const factory = new MockMailboxReaderFactory();
    const a = factory.createReader(fakeConfig('config-1') as never);
    const b = factory.createReader(fakeConfig('config-1') as never);
    expect(a).toBe(b);
  });

  it('returns independent reader instances for different MailConfiguration ids', () => {
    const factory = new MockMailboxReaderFactory();
    const a = factory.createReader(fakeConfig('config-1') as never);
    const b = factory.createReader(fakeConfig('config-2') as never);
    expect(a).not.toBe(b);
  });

  it('getReaderFor lets a test pre-seed a mailbox before triggering a sync', () => {
    const factory = new MockMailboxReaderFactory();
    const seeded = factory.getReaderFor('config-1');
    seeded.setFolderState('INBOX', 1n, 1n, []);

    const viaCreate = factory.createReader(fakeConfig('config-1') as never);
    expect(viaCreate).toBe(seeded);
  });

  it('reset() clears every tracked reader', () => {
    const factory = new MockMailboxReaderFactory();
    const before = factory.getReaderFor('config-1');
    factory.reset();
    const after = factory.getReaderFor('config-1');
    expect(after).not.toBe(before);
  });
});
