import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, HealthStatus } from '../../generated/prisma/enums';
import type { MailConfiguration, Prisma } from '../../generated/prisma/client';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import type { CreateMailSettingsDto, UpdateMailSettingsDto } from './mail-settings.dto';
import { isMicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';
import type { ImapCredentials } from './imap-credentials';
import type { SmtpCredentials } from './smtp-credentials';
import { ImapMailboxReaderFactory } from './imap-mailbox-reader-factory';
import { MailHealthService } from './mail-health.service';
import { MailImapHealthService } from './mail-imap-health.service';
import { SmtpMailTransport } from './smtp-mail-transport';

export type MailAuthModeInput =
  | { authMode: 'BASIC'; password: string }
  | { authMode: 'MICROSOFT_OAUTH2'; tenantId: string; clientId: string; clientSecret: string };

function parseScope(scope: string): { scopeKey: string; billingEntityId: string | null } {
  if (scope === 'GLOBAL') return { scopeKey: 'GLOBAL', billingEntityId: null };
  const match = /^BILLING_ENTITY:([A-Za-z0-9-]+)$/.exec(scope);
  if (!match) throw new BadRequestException('scope must be exactly "GLOBAL" or "BILLING_ENTITY:<id>".');
  return { scopeKey: scope, billingEntityId: match[1]! };
}

function buildCredentialsFromCreateDto(dto: CreateMailSettingsDto): MailAuthModeInput {
  if (dto.authMode === 'MICROSOFT_OAUTH2') {
    if (!dto.tenantId || !dto.clientId || !dto.clientSecret) {
      throw new BadRequestException('tenantId, clientId, and clientSecret are all required for MICROSOFT_OAUTH2.');
    }
    return { authMode: 'MICROSOFT_OAUTH2', tenantId: dto.tenantId, clientId: dto.clientId, clientSecret: dto.clientSecret };
  }
  if (!dto.password) {
    throw new BadRequestException('password is required for BASIC.');
  }
  return { authMode: 'BASIC', password: dto.password };
}

/** Serialized, browser-safe view of one MailConfiguration row — never includes a ciphertext,
 * password, or client secret. `authMode`/`credentialsConfigured` are derived by decrypting the
 * stored envelope ONLY long enough to read the non-secret `authMode` discriminant, immediately
 * discarding the rest — mirrors TechnicalConnectionsService's own configured/not-configured pattern. */
export interface SerializedMailSettings {
  id: string;
  scope: string;
  billingEntityId: string | null;
  label: string;
  environment: string;
  enabled: boolean;
  mailboxAddress: string;
  fromName: string;
  fromAddress: string;
  authMode: 'BASIC' | 'MICROSOFT_OAUTH2' | null;
  credentialsConfigured: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  inboundSyncEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  outboundSendEnabled: boolean;
  outboundSendCutoverAt: Date | null;
  lastHealthStatus: string;
  lastHealthCheckedAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly audit: AuditService,
    private readonly imapReaderFactory: ImapMailboxReaderFactory,
    private readonly smtpTransport: SmtpMailTransport,
    private readonly mailHealth: MailHealthService,
    private readonly imapHealth: MailImapHealthService,
  ) {}

  async list(): Promise<SerializedMailSettings[]> {
    const rows = await this.prisma.mailConfiguration.findMany({ orderBy: { scopeKey: 'asc' } });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string): Promise<SerializedMailSettings> {
    const row = await this.prisma.mailConfiguration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Mail configuration not found.');
    return this.serialize(row);
  }

  async create(dto: CreateMailSettingsDto, context: MutationContext): Promise<SerializedMailSettings> {
    const { scopeKey, billingEntityId } = parseScope(dto.scope);
    const credentials = buildCredentialsFromCreateDto(dto);
    const ciphertext = this.encryption.encrypt(credentials);
    const fromAddress = dto.fromAddress?.trim() || dto.mailboxAddress;

    const data: Prisma.MailConfigurationUncheckedCreateInput = {
      scopeKey,
      billingEntityId,
      label: dto.label,
      environment: dto.environment,
      enabled: dto.enabled,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      smtpUsername: dto.mailboxAddress,
      smtpCredentialsCiphertext: ciphertext,
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapSecure: dto.imapSecure,
      imapUsername: dto.mailboxAddress,
      imapCredentialsCiphertext: ciphertext,
      inboundSyncEnabled: dto.inboundSyncEnabled,
      outboundSendEnabled: dto.outboundSendEnabled,
      outboundSendCutoverAt: dto.outboundSendCutoverAt ? new Date(dto.outboundSendCutoverAt) : null,
      fromAddress,
      fromName: dto.fromName,
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.mailConfiguration.create({ data });
        const safe = this.serialize(record);
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'settings.mail.created',
            subjectType: 'MailConfiguration',
            subjectId: record.id,
            newState: safe,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return safe;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, dto: UpdateMailSettingsDto, context: MutationContext): Promise<SerializedMailSettings> {
    const existing = await this.prisma.mailConfiguration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Mail configuration not found.');
    const oldState = this.serialize(existing);

    const credentialInputCount = [dto.password, dto.tenantId, dto.clientId, dto.clientSecret].filter((v) => v !== undefined).length;
    if (credentialInputCount > 0 && dto.clearCredentials) {
      throw new BadRequestException('Provide new credentials or clear them, not both.');
    }

    let ciphertextUpdate: { smtpCredentialsCiphertext: string | null; imapCredentialsCiphertext: string | null } | undefined;
    let credentialsChanged = false;
    if (dto.clearCredentials) {
      ciphertextUpdate = { smtpCredentialsCiphertext: null, imapCredentialsCiphertext: null };
      credentialsChanged = true;
    } else {
      const nextAuthMode = dto.authMode ?? this.currentAuthMode(existing);
      const newCredentials = this.buildCredentialsFromUpdateDto(dto, nextAuthMode, existing);
      if (newCredentials) {
        const ciphertext = this.encryption.encrypt(newCredentials);
        ciphertextUpdate = { smtpCredentialsCiphertext: ciphertext, imapCredentialsCiphertext: ciphertext };
        credentialsChanged = true;
      }
    }

    const data: Prisma.MailConfigurationUncheckedUpdateInput = {
      label: dto.label,
      environment: dto.environment,
      enabled: dto.enabled,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpSecure: dto.smtpSecure,
      smtpUsername: dto.mailboxAddress,
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapSecure: dto.imapSecure,
      imapUsername: dto.mailboxAddress,
      inboundSyncEnabled: dto.inboundSyncEnabled,
      outboundSendEnabled: dto.outboundSendEnabled,
      outboundSendCutoverAt:
        dto.outboundSendCutoverAt === undefined ? undefined : dto.outboundSendCutoverAt === null ? null : new Date(dto.outboundSendCutoverAt),
      fromAddress: dto.fromAddress,
      fromName: dto.fromName,
      ...ciphertextUpdate,
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await tx.mailConfiguration.update({ where: { id }, data });
        const safe = this.serialize(record);
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'settings.mail.updated',
            subjectType: 'MailConfiguration',
            subjectId: record.id,
            oldState,
            newState: safe,
            metadata: { credentialsChanged, authModeChanged: dto.authMode !== undefined && dto.authMode !== this.currentAuthMode(existing) },
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return safe;
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  /**
   * Phase 3.1 §F — explicit ADMIN action only. Opens a REAL IMAP connection (decrypting
   * credentials, obtaining a Microsoft OAuth2 token via the same MicrosoftOAuthTokenProvider the
   * production reader uses, where applicable) and reads only mailbox METADATA
   * (getMailboxState — UIDVALIDITY/UIDNEXT) via a fresh ImapMailboxReader instance this method
   * constructs and closes itself. Structurally cannot advance any production sync cursor or create
   * an EmailMessage: those are written exclusively by MailInboundIngestService, which this method
   * never calls, and this reader instance is never handed to it.
   */
  async testImap(id: string): Promise<{ success: boolean; timestamp: Date; message: string }> {
    const config = await this.prisma.mailConfiguration.findUnique({ where: { id } });
    if (!config) throw new NotFoundException('Mail configuration not found.');

    const reader = this.imapReaderFactory.createReader(config);
    const timestamp = new Date();
    try {
      await reader.getMailboxState(config.imapFolder);
      await this.imapHealth.record(id, HealthStatus.HEALTHY, 'Manual IMAP connection test succeeded.');
      return { success: true, timestamp, message: 'IMAP connection succeeded.' };
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      await this.imapHealth.record(id, HealthStatus.UNAVAILABLE, `Manual IMAP connection test failed: ${sanitized}`);
      return { success: false, timestamp, message: sanitized };
    } finally {
      await reader.close();
    }
  }

  /**
   * Phase 3.1 §G — explicit ADMIN action only, NEVER "send a customer email." Uses nodemailer's
   * `verify()` through SmtpMailTransport's own auth-resolution logic (never duplicated here), which
   * authenticates the SMTP connection (including obtaining a Microsoft OAuth2 token where
   * applicable) without transmitting any message. No CommunicationOutbox/OperatorReplyOutbox/
   * EmailMessage row is read or written by this method.
   */
  async testSmtp(id: string): Promise<{ success: boolean; timestamp: Date; message: string }> {
    const config = await this.prisma.mailConfiguration.findUnique({ where: { id } });
    if (!config) throw new NotFoundException('Mail configuration not found.');

    const timestamp = new Date();
    try {
      await this.smtpTransport.verify(config);
      await this.mailHealth.record(id, HealthStatus.HEALTHY, 'Manual SMTP connection test succeeded.');
      return { success: true, timestamp, message: 'SMTP connection succeeded.' };
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      await this.mailHealth.record(id, HealthStatus.UNAVAILABLE, `Manual SMTP connection test failed: ${sanitized}`);
      return { success: false, timestamp, message: sanitized };
    }
  }

  private currentAuthMode(existing: MailConfiguration): 'BASIC' | 'MICROSOFT_OAUTH2' {
    if (!existing.smtpCredentialsCiphertext) return 'BASIC';
    const decrypted = this.encryption.decrypt<SmtpCredentials>(existing.smtpCredentialsCiphertext);
    return isMicrosoftOAuth2Credentials(decrypted) ? 'MICROSOFT_OAUTH2' : 'BASIC';
  }

  /** Returns undefined when no new credential material was supplied at all (blank on update means
   * KEEP the existing stored secret — never re-encrypts the existing envelope unnecessarily). */
  private buildCredentialsFromUpdateDto(
    dto: UpdateMailSettingsDto,
    authMode: 'BASIC' | 'MICROSOFT_OAUTH2',
    existing: MailConfiguration,
  ): MailAuthModeInput | undefined {
    if (authMode === 'MICROSOFT_OAUTH2') {
      if (dto.tenantId === undefined && dto.clientId === undefined && dto.clientSecret === undefined) {
        if (dto.authMode === 'MICROSOFT_OAUTH2' && this.currentAuthMode(existing) !== 'MICROSOFT_OAUTH2') {
          throw new BadRequestException('tenantId, clientId, and clientSecret are all required when switching to MICROSOFT_OAUTH2.');
        }
        return undefined;
      }
      const current =
        this.currentAuthMode(existing) === 'MICROSOFT_OAUTH2' && existing.smtpCredentialsCiphertext
          ? (this.encryption.decrypt<SmtpCredentials>(existing.smtpCredentialsCiphertext) as Extract<SmtpCredentials, { authMode: 'MICROSOFT_OAUTH2' }>)
          : undefined;
      const tenantId = dto.tenantId ?? current?.tenantId;
      const clientId = dto.clientId ?? current?.clientId;
      const clientSecret = dto.clientSecret ?? current?.clientSecret;
      if (!tenantId || !clientId || !clientSecret) {
        throw new BadRequestException('tenantId, clientId, and clientSecret are all required for MICROSOFT_OAUTH2.');
      }
      return { authMode: 'MICROSOFT_OAUTH2', tenantId, clientId, clientSecret };
    }
    if (dto.password === undefined) {
      if (dto.authMode === 'BASIC' && this.currentAuthMode(existing) !== 'BASIC') {
        throw new BadRequestException('password is required when switching to BASIC.');
      }
      return undefined;
    }
    return { authMode: 'BASIC', password: dto.password };
  }

  private serialize(row: MailConfiguration): SerializedMailSettings {
    let authMode: 'BASIC' | 'MICROSOFT_OAUTH2' | null = null;
    if (row.smtpCredentialsCiphertext) {
      const decrypted = this.encryption.decrypt<SmtpCredentials | ImapCredentials>(row.smtpCredentialsCiphertext);
      authMode = isMicrosoftOAuth2Credentials(decrypted) ? 'MICROSOFT_OAUTH2' : 'BASIC';
    }
    return {
      id: row.id,
      scope: row.scopeKey,
      billingEntityId: row.billingEntityId,
      label: row.label,
      environment: row.environment,
      enabled: row.enabled,
      mailboxAddress: row.smtpUsername,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      authMode,
      credentialsConfigured: Boolean(row.smtpCredentialsCiphertext),
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      inboundSyncEnabled: row.inboundSyncEnabled,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      outboundSendEnabled: row.outboundSendEnabled,
      outboundSendCutoverAt: row.outboundSendCutoverAt,
      lastHealthStatus: row.lastHealthStatus,
      lastHealthCheckedAt: row.lastHealthCheckedAt,
      lastSyncedAt: row.lastSyncedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Never returns a raw exception: strips anything resembling a base64 credential fragment and
   * caps length, mirroring MailOutboundService.sanitizeError()'s exact same discipline. */
  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED]').slice(0, 500);
  }
}
