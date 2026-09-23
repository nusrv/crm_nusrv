import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { IntegrationEnvironment } from '../../generated/prisma/enums';

const SCOPE_PATTERN = /^GLOBAL$|^BILLING_ENTITY:[A-Za-z0-9-]+$/;

export class CreateMailSettingsDto {
  @IsString()
  @Matches(SCOPE_PATTERN, { message: 'scope must be exactly "GLOBAL" or "BILLING_ENTITY:<id>".' })
  scope!: string;

  @IsString()
  @Length(2, 191)
  label!: string;

  @IsOptional()
  @IsEnum(IntegrationEnvironment)
  environment: IntegrationEnvironment = IntegrationEnvironment.SANDBOX;

  @IsOptional()
  @IsBoolean()
  enabled = true;

  @IsString()
  @Length(3, 320)
  mailboxAddress!: string;

  @IsString()
  @Length(1, 191)
  fromName!: string;

  @IsOptional()
  @IsString()
  @Length(3, 320)
  fromAddress?: string;

  @IsIn(['BASIC', 'MICROSOFT_OAUTH2'])
  authMode!: 'BASIC' | 'MICROSOFT_OAUTH2';

  @ValidateIf((dto: CreateMailSettingsDto) => dto.authMode === 'BASIC')
  @IsString()
  @Length(1, 500)
  password?: string;

  @ValidateIf((dto: CreateMailSettingsDto) => dto.authMode === 'MICROSOFT_OAUTH2')
  @IsString()
  @Length(1, 191)
  tenantId?: string;

  @ValidateIf((dto: CreateMailSettingsDto) => dto.authMode === 'MICROSOFT_OAUTH2')
  @IsString()
  @Length(1, 191)
  clientId?: string;

  @ValidateIf((dto: CreateMailSettingsDto) => dto.authMode === 'MICROSOFT_OAUTH2')
  @IsString()
  @Length(1, 500)
  clientSecret?: string;

  @IsString()
  @Length(1, 255)
  imapHost!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  imapPort!: number;

  @IsOptional()
  @IsBoolean()
  imapSecure = true;

  @IsOptional()
  @IsBoolean()
  inboundSyncEnabled = false;

  @IsString()
  @Length(1, 255)
  smtpHost!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort!: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure = true;

  @IsOptional()
  @IsBoolean()
  outboundSendEnabled = false;

  @IsOptional()
  @IsDateString()
  outboundSendCutoverAt?: string;
}

export class UpdateMailSettingsDto {
  @IsOptional()
  @IsString()
  @Length(2, 191)
  label?: string;

  @IsOptional()
  @IsEnum(IntegrationEnvironment)
  environment?: IntegrationEnvironment;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 320)
  mailboxAddress?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  fromName?: string;

  @IsOptional()
  @IsString()
  @Length(3, 320)
  fromAddress?: string;

  @IsOptional()
  @IsIn(['BASIC', 'MICROSOFT_OAUTH2'])
  authMode?: 'BASIC' | 'MICROSOFT_OAUTH2';

  // Blank/omitted on update means KEEP the existing stored secret — see MailSettingsService.
  // Only meaningful when `authMode` is also supplied (switching auth mode requires the matching
  // new credential material; see the service's own validation).
  @IsOptional()
  @IsString()
  @Length(1, 500)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  tenantId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  clientId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  clientSecret?: string;

  // Explicit action, never inferred from a blank field — see TechnicalConnectionsService's
  // identical precedent for `clearCredentials`.
  @IsOptional()
  @IsBoolean()
  clearCredentials?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  imapHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  imapPort?: number;

  @IsOptional()
  @IsBoolean()
  imapSecure?: boolean;

  @IsOptional()
  @IsBoolean()
  inboundSyncEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsBoolean()
  outboundSendEnabled?: boolean;

  // Explicit null clears a configured cutover; omitted leaves it unchanged; a date string sets it.
  @IsOptional()
  @ValidateIf((dto: UpdateMailSettingsDto) => dto.outboundSendCutoverAt !== null)
  @IsDateString()
  outboundSendCutoverAt?: string | null;
}
