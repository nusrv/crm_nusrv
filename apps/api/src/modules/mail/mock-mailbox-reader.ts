import type { FetchSinceResult, FetchedMailboxMessage, MailboxReader, MailboxSyncState } from './mailbox-reader';

interface MockFolderState {
  uidValidity: bigint;
  uidNext: bigint;
  messages: FetchedMailboxMessage[];
}

/**
 * Slice C §3 — deterministic, no network traffic, ever. Never decrypts (and has no access to) any
 * credential — it doesn't even accept a MailConfiguration. State is entirely in-memory and
 * explicitly set up by the caller (a test, or a non-production default), so behavior never depends
 * on real time, randomness, or an external system.
 */
export class MockMailboxReader implements MailboxReader {
  private readonly folders = new Map<string, MockFolderState>();
  closed = false;

  /** Test/setup seam: establishes or replaces a folder's full state. */
  setFolderState(folder: string, uidValidity: bigint, uidNext: bigint, messages: FetchedMailboxMessage[] = []): void {
    this.folders.set(folder, { uidValidity, uidNext, messages: [...messages] });
  }

  /** Test/setup seam: appends one message and advances uidNext past it, as a real server would. */
  appendMessage(folder: string, message: FetchedMailboxMessage): void {
    const state = this.folders.get(folder);
    if (!state) {
      throw new Error(`MockMailboxReader: folder "${folder}" has no configured state — call setFolderState first.`);
    }
    state.messages.push(message);
    if (message.uid >= state.uidNext) {
      state.uidNext = message.uid + 1n;
    }
  }

  /** Test/setup seam: simulates the mailbox being recreated (Slice C §11 fail-closed scenario). */
  changeUidValidity(folder: string, newUidValidity: bigint, newUidNext: bigint): void {
    const state = this.folders.get(folder);
    if (!state) {
      throw new Error(`MockMailboxReader: folder "${folder}" has no configured state — call setFolderState first.`);
    }
    state.uidValidity = newUidValidity;
    state.uidNext = newUidNext;
    state.messages = [];
  }

  getMailboxState(folder: string): Promise<MailboxSyncState> {
    const state = this.folders.get(folder) ?? { uidValidity: 1n, uidNext: 1n, messages: [] };
    return Promise.resolve({ uidValidity: state.uidValidity, uidNext: state.uidNext });
  }

  fetchMessagesSince(
    folder: string,
    expectedUidValidity: bigint,
    afterUid: bigint,
    limit: number,
  ): Promise<FetchSinceResult> {
    const state = this.folders.get(folder) ?? { uidValidity: 1n, uidNext: 1n, messages: [] };

    // Fresh identity check against THIS (the only) state snapshot — mirrors the real reader
    // checking UIDVALIDITY inside the same selection used for the fetch, closing the TOCTOU window
    // a separate, earlier getMailboxState() call would otherwise leave open.
    if (state.uidValidity !== expectedUidValidity) {
      return Promise.resolve({ outcome: 'uidvalidity_changed', currentUidValidity: state.uidValidity });
    }

    // Finite upper bound — never an open-ended "afterUid+1:*" range, which under real IMAP
    // semantics would still match the mailbox's single highest-UID message even when afterUid+1 is
    // numerically past every existing UID.
    const currentUpperUid = state.uidNext > 0n ? state.uidNext - 1n : 0n;
    if (afterUid >= currentUpperUid) {
      return Promise.resolve({ outcome: 'ok', messages: [] });
    }

    const matching = state.messages
      .filter((message) => message.uid > afterUid && message.uid <= currentUpperUid)
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    return Promise.resolve({ outcome: 'ok', messages: matching.slice(0, limit) });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
