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

  it('increments failedAttempts atomically at the database level and locks out once the threshold is reached', async () => {
    // failedAttempts is never computed locally (no "read then +1"): the service issues an atomic
    // `{ increment: 1 }` write and reacts only to the value Prisma/MariaDB return from that same
    // write, which is what makes concurrent failed attempts safe to count.
    const user = { ...userWithPassword(await hash('correct-password')), failedAttempts: 4 };
    type AuditInput = { eventKey: string; metadata: Record<string, unknown> };
    let capturedAudit: AuditInput | undefined;
    const update = jest.fn(() => Promise.resolve({ ...user, failedAttempts: 5 }));
    const updateMany = jest.fn<
      (input: {
        where: { id: string; failedAttempts: { gte: number } };
        data: { lockedUntil: Date };
      }) => Promise<{ count: number }>
    >(() => Promise.resolve({ count: 1 }));
    const recordAudit = jest.fn((input: AuditInput) => {
      capturedAudit = input;
      return Promise.resolve({ id: 'audit-id' });
    });
    const audit = { record: recordAudit };
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update, updateMany } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      { verify: jest.fn() } as never,
      audit as never,
    );

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { failedAttempts: { increment: 1 } },
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const lockCall = updateMany.mock.calls[0]?.[0];
    if (!lockCall) throw new Error('Expected the conditional lock-setting call');
    // Conditional on current state — not a plain update() by id alone.
    expect(lockCall.where).toEqual({ id: user.id, failedAttempts: { gte: 5 } });
    expect(lockCall.data.lockedUntil).toBeInstanceOf(Date);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    if (!capturedAudit) {
      throw new Error('Expected the failed-login audit event');
    }
    expect(capturedAudit.eventKey).toBe('identity.login_failed');
    // The audited count is the value the DB actually returned from the increment, not a
    // locally-recomputed one.
    expect(capturedAudit.metadata.failedAttempts).toBe(5);
  });

  it('a stale threshold observation cannot re-lock an account a newer concurrent successful login already reset', async () => {
    // Interleaving under test: this failed attempt's increment observes failedAttempts=5 (crossing
    // the threshold), but before its conditional lock-setting write executes, a concurrent
    // successful login has already reset failedAttempts=0/lockedUntil=null. The conditional
    // updateMany's WHERE (failedAttempts >= 5) no longer matches anything, so it must affect 0 rows
    // and the account must NOT end up locked.
    const user = { ...userWithPassword(await hash('correct-password')), failedAttempts: 4 };
    const update = jest.fn(() => Promise.resolve({ ...user, failedAttempts: 5 }));
    // Simulates the successful concurrent login having already reset the row: the conditional
    // WHERE clause (failedAttempts >= 5) matches 0 rows.
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update, updateMany } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      { verify: jest.fn() } as never,
      { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) } as never,
    );

    // The stale failed-login flow itself still reports failure (the password was in fact wrong) —
    // what must NOT happen is the account ending up locked as a side effect of a race it lost.
    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: user.id, failedAttempts: { gte: 5 } },
      data: { lockedUntil: expect.any(Date) as Date },
    });
    // The conditional write returning count:0 is not treated as an error — there is nothing further
    // for the service to do here; the reset that won the race stands.
  });

  it('does not lock the account when an ordinary failed attempt stays below the threshold', async () => {
    const user = { ...userWithPassword(await hash('correct-password')), failedAttempts: 1 };
    const update = jest.fn(() => Promise.resolve({ ...user, failedAttempts: 2 }));
    const updateMany = jest.fn();
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update, updateMany } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      { verify: jest.fn() } as never,
      { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) } as never,
    );

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Only the increment write happens — no conditional lock write is even attempted.
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('each concurrent failed attempt reacts only to its own atomic increment result, never a shared local count', async () => {
    // Simulates what two genuinely concurrent requests would each observe from a real atomic
    // `UPDATE users SET failed_attempts = failed_attempts + 1` — two distinct, correctly
    // incremented values, never the same stale "+1" computed from one shared local read.
    const user = { ...userWithPassword(await hash('correct-password')), failedAttempts: 4 };
    let call = 0;
    const update = jest.fn(() => {
      call += 1;
      // Request A's increment lands first (-> 5), request B's lands second (-> 6), exactly as
      // two serialized row-locked UPDATEs on the same account would behave.
      return Promise.resolve({ ...user, failedAttempts: call === 1 ? 5 : 6 });
    });
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const service = new AuthService(
      { user: { findUnique: jest.fn(() => Promise.resolve(user)), update, updateMany } } as never,
      {} as never,
      new ConfigService({ CAPTCHA_PROVIDER: 'none' }),
      { verify: jest.fn() } as never,
      { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) } as never,
    );

    const [resultA, resultB] = await Promise.allSettled([
      service.login({ email: user.email, password: 'wrong-password' }),
      service.login({ email: user.email, password: 'wrong-password' }),
    ]);

    expect(resultA.status).toBe('rejected');
    expect(resultB.status).toBe('rejected');
    if (resultA.status === 'rejected') expect(resultA.reason).toBeInstanceOf(UnauthorizedException);
    if (resultB.status === 'rejected') expect(resultB.reason).toBeInstanceOf(UnauthorizedException);
    // Both requests crossed >=5 on their own distinct returned value, so both attempt the
    // conditional lockedUntil write.
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
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

  describe('refresh', () => {
    const REFRESH_TOKEN = 'valid-refresh-token';
    const payload = { sub: '10000000-0000-4000-8000-000000000001', sid: 'session-1', type: 'refresh' };

    function buildService(session: unknown) {
      const jwt = {
        verifyAsync: jest.fn(() => Promise.resolve(payload)),
        signAsync: jest.fn(() => Promise.resolve('new-access-token')),
      };
      const authSession = {
        findUnique: jest.fn(() => Promise.resolve(session)),
        updateMany: jest.fn<
          (input: {
            where: { id: string; revokedAt: null };
            data: { revokedAt: Date };
          }) => Promise<{ count: number }>
        >(() => Promise.resolve({ count: 1 })),
      };
      const config = new ConfigService({
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      });
      const service = new AuthService(
        { authSession } as never,
        jwt as never,
        config,
        {} as never,
        {} as never,
      );
      return { service, jwt, authSession };
    }

    async function baseSession(overrides: Record<string, unknown> = {}) {
      return {
        id: 'session-1',
        userId: payload.sub,
        refreshTokenHash: await hash(REFRESH_TOKEN),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        user: {
          id: payload.sub,
          email: 'admin@example.test',
          displayName: 'Test Admin',
          active: true,
          roles: [{ role: { code: 'ADMIN' } }],
        },
        ...overrides,
      };
    }

    it('active user with a valid refresh session succeeds and returns a new access token', async () => {
      const { service, authSession } = buildService(await baseSession());
      const result = await service.refresh(REFRESH_TOKEN);
      expect(result.accessToken).toBe('new-access-token');
      expect(result.user).toMatchObject({ id: payload.sub, roles: ['ADMIN'] });
      expect(authSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects refresh for an inactive user and revokes the session', async () => {
      const { service, authSession } = buildService(
        await baseSession({ user: { ...(await baseSession()).user, active: false } }),
      );
      await expect(service.refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authSession.updateMany).toHaveBeenCalledTimes(1);
      const call = authSession.updateMany.mock.calls[0]?.[0];
      if (!call) throw new Error('Expected the session-revoke call');
      expect(call.where).toEqual({ id: 'session-1', revokedAt: null });
      expect(call.data.revokedAt).toBeInstanceOf(Date);
    });

    it('reflects roles changed after login in the refreshed token', async () => {
      const session = await baseSession({
        user: {
          ...(await baseSession()).user,
          roles: [{ role: { code: 'ADMIN' } }, { role: { code: 'ACCOUNTANT' } }],
        },
      });
      const { service } = buildService(session);
      const result = await service.refresh(REFRESH_TOKEN);
      expect(result.user.roles).toEqual(['ADMIN', 'ACCOUNTANT']);
    });

    it('rejects a revoked session', async () => {
      const { service } = buildService(await baseSession({ revokedAt: new Date() }));
      await expect(service.refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired session', async () => {
      const { service } = buildService(
        await baseSession({ expiresAt: new Date(Date.now() - 1_000) }),
      );
      await expect(service.refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when no session is found', async () => {
      const { service } = buildService(null);
      await expect(service.refresh(REFRESH_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
