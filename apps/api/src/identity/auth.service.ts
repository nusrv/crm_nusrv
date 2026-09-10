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
      // Atomic increment at the database level: two concurrent failed attempts must both be
      // counted, not overwrite each other via a stale read -> +1 -> absolute-write race. The
      // lockout decision is then made from the value Prisma returns from that same atomic
      // increment, never from a separately re-read (and potentially stale) value.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: { increment: 1 } },
      });
      if (updated.failedAttempts >= 5) {
        // Conditional on CURRENT state, not a plain update(): a concurrent successful login could
        // have reset failedAttempts to 0 between our increment above and this write. Requiring
        // failedAttempts still be >= 5 at write time means that reset wins — this stale threshold
        // observation cannot re-lock an account a newer successful login just cleared. If the
        // condition no longer holds, this simply affects 0 rows; there is nothing to roll back or
        // report, since not locking is exactly the correct outcome in that case.
        await this.prisma.user.updateMany({
          where: { id: user.id, failedAttempts: { gte: 5 } },
          data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1_000) },
        });
      }
      await this.audit.record({
        actorType: ActorType.USER,
        actorId: user.id,
        eventKey: 'identity.login_failed',
        subjectType: 'User',
        subjectId: user.id,
        metadata: { remoteAddress, failedAttempts: updated.failedAttempts },
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

    if (!session.user.active) {
      // A disabled user must not be able to mint a new access token, and their refresh session
      // must not remain usable if the account is re-enabled later without a fresh login — revoke
      // it now, the same way logout() revokes a session explicitly.
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid session.');
    }

    // Always reload current roles from the join table (already fetched above via `include`) rather
    // than trusting anything embedded in the refresh token itself — a role change since login must
    // be reflected in the next access token.
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
