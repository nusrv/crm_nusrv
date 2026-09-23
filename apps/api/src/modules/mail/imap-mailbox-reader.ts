import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, ImapFlowOptions, MailboxLockObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject, HeaderValue } from 'mailparser';
import type { MailConfiguration } from '../../generated/prisma/client';
import type { ImapCredentials } from './imap-credentials';
import { isMicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';
import { MicrosoftOAuthTokenProvider } from './microsoft-oauth-token-provider';
import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  MAX_INBOUND_MESSAGE_BYTES,
} from './imap-timing.constants';
import type { FetchSinceResult, FetchedMailboxMessage, MailboxReader, MailboxSyncState } from './mailbox-reader';
import type { SecretEncryptionService } from '../../security/secret-encryption.service';

function headerString(value: HeaderValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === 'string');
    return first;
  }
  return undefined;
}

function joinReferences(refs: string[] | string | undefined): string | undefined {
  if (!refs) return undefined;
  return Array.isArray(refs) ? refs.join(' ') : refs;
}

function extractToAddresses(to: AddressObject | AddressObject[] | undefined): string[] {
  if (!to) return [];
  const objects = Array.isArray(to) ? to : [to];
  return objects.flatMap((entry) =>
    entry.value.map((address) => address.address).filter((address): address is string => Boolean(address)),
  );
}

const EMPTY_MESSAGE: Omit<FetchedMailboxMessage, 'uid' | 'internalDate'> = {
  subject: undefined,
  fromAddress: undefined,
  toAddresses: [],
  messageIdHeader: undefined,
  inReplyToHeader: undefined,
  referencesHeader: undefined,
  renewalCaseIdHeader: undefined,
  text: undefined,
  html: undefined,
  parseFailed: true,
};

/**
 * Slice C §3 — the real IMAP implementation. Credentials are decrypted lazily, immediately before
 * the first connection attempt, and never cached beyond the single ImapFlow client instance's own
 * auth options (never logged, never persisted in decrypted form). Connections are closed cleanly
 * via close(), which is idempotent and safe even if the reader never successfully connected.
 *
 * One reader instance is scoped to one MailConfiguration for the lifetime of one sync attempt —
 * MailInboundIngestService constructs a fresh instance per config per scheduled run rather than
 * pooling/reusing connections across configs or across runs.
 *
 * Supports two decrypted-credential shapes (see imap-credentials.ts): BASIC (unchanged — a plain
 * password) and MICROSOFT_OAUTH2 (a Microsoft Entra app-only access token resolved via
 * MicrosoftOAuthTokenProvider immediately before connecting, never a password). Every existing
 * BASIC-configured MailConfiguration keeps behaving exactly as before this feature was added; all
 * UIDVALIDITY/cursor/bounded-fetch/MIME-parsing behavior above is unaffected by auth mode.
 */
export class ImapMailboxReader implements MailboxReader {
  private client: ImapFlow | undefined;
  private lock: MailboxLockObject | undefined;
  private openedFolder: string | undefined;

  /** Test seams only — default to the real ImapFlow/mailparser entry points in production.
   * Overriding these lets adapter-contract tests substitute fakes without module-level mocking,
   * which does not fit this project's CJS/NodeNext TypeScript configuration (see
   * smtp-mail-transport.ts's `transportFactory` for the established precedent of this pattern). */
  clientFactory: (options: ImapFlowOptions) => ImapFlow = (options) => new ImapFlow(options);
  messageParser: typeof simpleParser = simpleParser;

  constructor(
    private readonly config: MailConfiguration,
    private readonly encryption: SecretEncryptionService,
    // Defaulted purely so every pre-existing BASIC-only test construction site
    // (`new ImapMailboxReader(config, encryption)`) keeps compiling unchanged; those tests never
    // reach a MICROSOFT_OAUTH2 credential, so this default instance's real fetch is never invoked.
    // ImapMailboxReaderFactory (the real, NestJS-injected production caller) always passes an
    // explicit, shared instance instead — see that class.
    private readonly oauthTokenProvider: MicrosoftOAuthTokenProvider = new MicrosoftOAuthTokenProvider(),
  ) {}

  async getMailboxState(folder: string): Promise<MailboxSyncState> {
    const client = await this.ensureConnected();
    await this.ensureFolderOpen(client, folder);
    const mailbox = client.mailbox;
    if (!mailbox) {
      throw new Error('ImapMailboxReader: mailbox is not open after acquiring its lock.');
    }
    return { uidValidity: mailbox.uidValidity, uidNext: BigInt(mailbox.uidNext) };
  }

  async fetchMessagesSince(
    folder: string,
    expectedUidValidity: bigint,
    afterUid: bigint,
    limit: number,
  ): Promise<FetchSinceResult> {
    if (limit <= 0) return { outcome: 'ok', messages: [] };
    const client = await this.ensureConnected();
    // Fresh SELECT/lock for this folder — this reader is constructed fresh per config per sync
    // attempt (see class doc comment), so this is genuinely the first selection this run, not a
    // cached one. That is what makes the UIDVALIDITY read immediately below trustworthy as "read
    // inside the same mailbox selection used for the fetch," closing the TOCTOU window a separate,
    // earlier getMailboxState() call would leave open.
    await this.ensureFolderOpen(client, folder);
    const mailbox = client.mailbox;
    if (!mailbox) {
      throw new Error('ImapMailboxReader: mailbox is not open after acquiring its lock.');
    }

    const currentUidValidity = mailbox.uidValidity;
    if (currentUidValidity !== expectedUidValidity) {
      // Report immediately — no message source is ever fetched under a stale identity assumption.
      return { outcome: 'uidvalidity_changed', currentUidValidity };
    }

    // Finite upper bound computed from THIS SAME selection. Never an open-ended "afterUid+1:*"
    // range: IMAP UID ranges are order-independent, so "559:*" still matches the mailbox's single
    // highest-UID message even when 559 is numerically above every existing UID — using it as an
    // incremental range would silently re-return historical mail.
    const uidNext = BigInt(mailbox.uidNext);
    const currentUpperUid = uidNext > 0n ? uidNext - 1n : 0n;
    if (afterUid >= currentUpperUid) {
      return { outcome: 'ok', messages: [] };
    }

    const results: FetchedMailboxMessage[] = [];
    const range = `${afterUid + 1n}:${currentUpperUid}`;
    for await (const message of client.fetch(
      range,
      { uid: true, internalDate: true, source: { maxLength: MAX_INBOUND_MESSAGE_BYTES } },
      { uid: true },
    )) {
      const uid = BigInt(message.uid);
      // Defensive re-filter even against a finite, correctly-bounded range request: never trust
      // the server/library to have honored it exactly.
      if (uid <= afterUid || uid > currentUpperUid) continue;
      results.push(await this.parseFetchedMessage(uid, message));
      if (results.length >= limit) break;
    }
    results.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    return { outcome: 'ok', messages: results.slice(0, limit) };
  }

  async close(): Promise<void> {
    if (this.lock) {
      this.lock.release();
      this.lock = undefined;
      this.openedFolder = undefined;
    }
    if (this.client) {
      const client = this.client;
      this.client = undefined;
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  private async ensureConnected(): Promise<ImapFlow> {
    if (this.client) return this.client;
    const credentials = this.config.imapCredentialsCiphertext
      ? this.encryption.decrypt<ImapCredentials>(this.config.imapCredentialsCiphertext)
      : undefined;
    const auth = await this.resolveAuth(credentials);
    const client = this.clientFactory({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: this.config.imapSecure,
      auth,
      logger: false,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    });
    await client.connect();
    this.client = client;
    return client;
  }

  /** MICROSOFT_OAUTH2 credentials never reach ImapFlow as a password — only a freshly resolved
   * access token, via ImapFlow's native `accessToken` auth option (XOAUTH2), so ImapFlow never
   * itself holds the client secret; MicrosoftOAuthTokenProvider remains the single place that ever
   * contacts Microsoft's identity platform. */
  private async resolveAuth(
    credentials: ImapCredentials | undefined,
  ): Promise<{ user: string; accessToken: string } | { user: string; pass: string } | undefined> {
    if (!credentials) return undefined;
    if (isMicrosoftOAuth2Credentials(credentials)) {
      const accessToken = await this.oauthTokenProvider.getAccessToken(credentials);
      return { user: this.config.imapUsername, accessToken };
    }
    return { user: this.config.imapUsername, pass: credentials.password };
  }

  private async ensureFolderOpen(client: ImapFlow, folder: string): Promise<void> {
    if (this.openedFolder === folder && this.lock) return;
    if (this.lock) {
      this.lock.release();
      this.lock = undefined;
    }
    this.lock = await client.getMailboxLock(folder);
    this.openedFolder = folder;
  }

  private async parseFetchedMessage(uid: bigint, message: FetchMessageObject): Promise<FetchedMailboxMessage> {
    const internalDate =
      message.internalDate instanceof Date
        ? message.internalDate
        : message.internalDate
          ? new Date(message.internalDate)
          : undefined;

    if (!message.source || message.source.length === 0) {
      return { uid, internalDate, ...EMPTY_MESSAGE };
    }

    try {
      const parsed = await this.messageParser(message.source);
      return {
        uid,
        internalDate,
        subject: parsed.subject,
        fromAddress: parsed.from?.value?.[0]?.address,
        toAddresses: extractToAddresses(parsed.to),
        messageIdHeader: parsed.messageId ?? headerString(parsed.headers.get('message-id')),
        inReplyToHeader: parsed.inReplyTo ?? headerString(parsed.headers.get('in-reply-to')),
        referencesHeader: joinReferences(parsed.references) ?? headerString(parsed.headers.get('references')),
        renewalCaseIdHeader: headerString(parsed.headers.get('x-renewal-case-id')),
        text: parsed.text,
        html: parsed.html,
        parseFailed: false,
      };
    } catch {
      // §26 — one malformed MIME message must not block the mailbox: fall back to a minimal
      // record carrying only what the FETCH response itself already gave us (uid/internalDate),
      // classified HUMAN_REVIEW by the ingest service, and the cursor still advances past it.
      return { uid, internalDate, ...EMPTY_MESSAGE };
    }
  }
}
