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
      CAPTCHA_PROVIDER: 'mock',
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

  it('logs in without captchaToken and skips CAPTCHA verification when disabled', async () => {
    const user = userWithPassword(await hash('correct-password'));
    const prisma = {
      user: {
        findUnique: jest.fn(() => Promise.resolve(user)),
        update: jest.fn(() => Promise.resolve(user)),
      },
      authSession: { create: jest.fn(() => Promise.resolve({ id: 'session-id' })) },
    };
    const jwt = {
      signAsync: jest.fn((payload: { type: string }) =>
        Promise.resolve(payload.type === 'refresh' ? 'refresh-token' : 'access-token'),
      ),
      decode: jest.fn(() => ({ exp: Math.floor(Date.now() / 1_000) + 3_600 })),
    };
    const config = new ConfigService({
      CAPTCHA_PROVIDER: 'none',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    });
    const captcha = { verify: jest.fn(() => Promise.resolve(false)) };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      config,
      captcha as never,
      audit as never,
    );

    await expect(
      service.login({ email: user.email, password: 'correct-password' }),
    ).resolves.toMatchObject({ mfaRequired: false, user: { id: user.id } });
    expect(captcha.verify).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'identity.login_succeeded' }),
    );
  });

  it('preserves wrong-password failure counting and account lockout when CAPTCHA is disabled', async () => {
    const user = { ...userWithPassword(await hash('correct-password')), failedAttempts: 4 };
    type UpdateInput = {
      where: { id: string };
      data: { failedAttempts: number; lockedUntil: Date };
    };
    type AuditInput = { eventKey: string; metadata: Record<string, unknown> };
    let capturedUpdate: UpdateInput | undefined;
    let capturedAudit: AuditInput | undefined;
    const update = jest.fn((input: UpdateInput) => {
      capturedUpdate = input;
      return Promise.resolve(user);
    });
    const recordAudit = jest.fn((input: AuditInput) => {
      capturedAudit = input;
      return Promise.resolve({ id: 'audit-id' });
    });
    const audit = { record: recordAudit };
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      { verify: jest.fn() } as never,
      audit as never,
    );

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledTimes(1);
    if (!capturedUpdate) {
      throw new Error('Expected the failed-login update');
    }
    expect(capturedUpdate.where).toEqual({ id: user.id });
    expect(capturedUpdate.data.failedAttempts).toBe(5);
    expect(capturedUpdate.data.lockedUntil).toBeInstanceOf(Date);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    if (!capturedAudit) {
      throw new Error('Expected the failed-login audit event');
    }
    expect(capturedAudit.eventKey).toBe('identity.login_failed');
    expect(capturedAudit.metadata.failedAttempts).toBe(5);
  });

  it('continues rejecting an already locked account when CAPTCHA is disabled', async () => {
    const user = {
      ...userWithPassword(await hash('correct-password')),
      lockedUntil: new Date(Date.now() + 60_000),
    };
    const update = jest.fn();
    const captcha = { verify: jest.fn() };
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      captcha as never,
      { record: jest.fn() } as never,
    );

    await expect(
      service.login({ email: user.email, password: 'correct-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(captcha.verify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects invalid CAPTCHA before looking up an account', async () => {
    const findUnique = jest.fn();
    const service = new AuthService(
      { user: { findUnique } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'mock' }),
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
