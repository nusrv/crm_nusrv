import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser, RoleCode } from '@cp/shared';
import { hash, verify } from 'argon2';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { ActorType } from '../generated/prisma/enums';
import { CaptchaService } from './captcha.service';
import type { LoginDto } from './login.dto';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  type: 'refresh';
  exp: number;
}

export type LoginResult =
  { mfaRequired: true } | ({ mfaRequired: false; user: AuthenticatedUser } & TokenPair);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly captcha: CaptchaService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginDto, remoteAddress?: string): Promise<LoginResult> {
    const captchaProvider = this.config.getOrThrow<string>('CAPTCHA_PROVIDER');
    if (
      captchaProvider !== 'none' &&
      !(await this.captcha.verify(input.captchaToken, remoteAddress))
    ) {
      throw new UnauthorizedException('Authentication failed.');
    }

    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    const now = new Date();
    if (!user?.active || (user.lockedUntil && user.lockedUntil > now)) {
      throw new UnauthorizedException('Authentication failed.');
    }

    if (!(await verify(user.passwordHash, input.password))) {
      const failedAttempts = user.failedAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts,
          lockedUntil: failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1_000) : null,
        },
      });
      await this.audit.record({
        actorType: ActorType.USER,
        actorId: user.id,
        eventKey: 'identity.login_failed',
        subjectType: 'User',
        subjectId: user.id,
        metadata: { remoteAddress, failedAttempts },
      });
      throw new UnauthorizedException('Authentication failed.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    if (user.mfaEnabled) {
      return { mfaRequired: true };
    }

    const authenticatedUser = this.toAuthenticatedUser(user);
    const tokens = await this.issueTokens(authenticatedUser);
    await this.audit.record({
      actorType: ActorType.USER,
      actorId: user.id,
      eventKey: 'identity.login_succeeded',
      subjectType: 'User',
      subjectId: user.id,
      metadata: { remoteAddress },
    });
    return { mfaRequired: false, user: authenticatedUser, ...tokens };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid session.');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid session.');

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await verify(session.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException('Invalid session.');
    }

    const user = this.toAuthenticatedUser(session.user);
    return { accessToken: await this.signAccessToken(user), user };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
      await this.prisma.authSession.updateMany({
        where: { id: payload.sid, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Clearing a stale or malformed browser cookie is still a successful logout.
    }
  }

  private async issueTokens(user: AuthenticatedUser): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL') as never,
      },
    );
    const decoded = this.jwt.decode<RefreshPayload>(refreshToken);
    const refreshExpiresAt = new Date(decoded.exp * 1_000);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: await hash(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      refreshExpiresAt,
    };
  }

  private signAccessToken(user: AuthenticatedUser): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        type: 'access',
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL') as never,
      },
    );
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    roles: Array<{ role: { code: string } }>;
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map(({ role }) => role.code as RoleCode),
    };
  }
}
