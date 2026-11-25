import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { readVerifiedAccessContext } from './verified-access-context';

describe('JwtStrategy session-bound authorization', () => {
  const config = new ConfigService({ JWT_ACCESS_SECRET: 'test-secret'.repeat(4) });
  const claims = () => {
    const iat = Math.floor(Date.now() / 1000);
    return { sub: 'account', sid: 'session', type: 'access', iat, exp: iat + 900, roles: ['ADMIN'] };
  };
  const currentSession = () => ({
    userId: 'account',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    user: { id: 'account', email: 'account@example.test', displayName: 'Account', active: true,
      roles: [{ role: { code: 'ACCOUNTANT' } }] },
  });
  function build(session: unknown) {
    const findUnique = jest.fn(() => Promise.resolve(session));
    return { findUnique, strategy: new JwtStrategy(config, { authSession: { findUnique } } as never) };
  }

  it('uses current persisted roles rather than the claims from token issuance', async () => {
    const { strategy } = build(currentSession());
    await expect(strategy.validate(claims())).resolves.toMatchObject({ id: 'account', roles: ['ACCOUNTANT'] });
  });

  it('keeps verified session identity server-only, not in the public user object', async () => {
    const { strategy } = build(currentSession());
    const payload = claims();
    const user = await strategy.validate(payload);
    expect(readVerifiedAccessContext(user)).toEqual({ actorId: 'account', sessionId: 'session', accessExpiresAt: payload.exp * 1000 });
    expect(JSON.stringify(user)).not.toContain('session');
    expect(readVerifiedAccessContext({ ...user })).toBeNull();
  });

  it('rejects legacy access tokens before reading a session', async () => {
    const { strategy, findUnique } = build(currentSession());
    await expect(strategy.validate({ ...claims(), sid: undefined })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a late access token after logout and a token for a disabled account', async () => {
    const session = currentSession();
    const revoked = build({ ...session, revokedAt: new Date() });
    const disabled = build({ ...session, user: { ...session.user, active: false } });
    await expect(revoked.strategy.validate(claims())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(disabled.strategy.validate(claims())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
