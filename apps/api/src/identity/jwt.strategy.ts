import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthenticatedUser, RoleCode } from '@cp/shared';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ACCESS_COOKIE } from './auth.constants';
import { PrismaService } from '../database/prisma.service';
import { isBoundAccessToken, isCurrentSession } from './session-policy';

interface AccessTokenPayload {
  sub?: unknown;
  sid?: unknown;
  type?: unknown;
  iat?: unknown;
  exp?: unknown;
}

function cookieExtractor(request: Request): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (!isBoundAccessToken(payload, Date.now())) throw new UnauthorizedException('Invalid session.');
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            active: true,
            roles: { select: { role: { select: { code: true } } } },
          },
        },
      },
    });
    const now = Date.now();
    if (!session?.user.active || !isCurrentSession(session, payload.sub, now) || !isBoundAccessToken(payload, now)) {
      throw new UnauthorizedException('Invalid session.');
    }
    return {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      roles: session.user.roles.map(({ role }) => role.code as RoleCode),
    };
  }
}
