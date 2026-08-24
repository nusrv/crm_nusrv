import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import { AuthService } from './auth.service';

function userWithPassword(passwordHash: string) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'admin@example.test',
    displayName: 'Test Admin',
    passwordHash,
    active: true,
    failedAttempts: 0,
    lockedUntil: null,
    mfaEnabled: false,
    roles: [{ role: { code: 'ADMIN' } }],
  };
}

describe('AuthService', () => {
  it('verifies CAPTCHA and password, resets lockout, and creates a hashed refresh session', async () => {
    const user = userWithPassword(await hash('correct-password'));
    let sessionData: { refreshTokenHash: string } | undefined;
    const prisma = {
      user: {
        findUnique: jest.fn(() => Promise.resolve(user)),
        update: jest.fn(() => Promise.resolve(user)),
      },
      authSession: {
        create: jest.fn((input: unknown) => {
          sessionData = (input as { data: { refreshTokenHash: string } }).data;
          return Promise.resolve({ id: 'session-id' });
        }),
      },
    };
    const jwt = {
      signAsync: jest.fn((payload: { type: string }) =>
        Promise.resolve(payload.type === 'refresh' ? 'refresh-token' : 'access-token'),
      ),
      decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1_000) + 3_600 })),
    };
    const config = new ConfigService({
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    });
    const captcha = { verify: jest.fn(() => Promise.resolve(true)) };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      config,
      captcha as never,
      audit as never,
    );

    const result = await service.login({
      email: 'ADMIN@example.test',
      password: 'correct-password',
      captchaToken: 'valid-captcha',
    });

    expect(result).toMatchObject({
      mfaRequired: false,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { email: 'admin@example.test', roles: ['ADMIN'] },
    });
    expect(captcha.verify).toHaveBeenCalledWith('valid-captcha', undefined);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    expect(sessionData?.refreshTokenHash).not.toBe('refresh-token');
    expect(await verify(sessionData?.refreshTokenHash ?? '', 'refresh-token')).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'identity.login_succeeded',
      }),
    );
  });

  it('rejects invalid CAPTCHA before looking up an account', async () => {
    const findUnique = jest.fn();
    const service = new AuthService(
      { user: { findUnique } } as never,
      {} as never,
      new ConfigService({}),
      { verify: jest.fn(() => Promise.resolve(false)) } as never,
      {} as never,
    );

    await expect(
      service.login({
        email: 'admin@example.test',
        password: 'correct-password',
        captchaToken: 'invalid',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
