import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { AuthController } from './auth.controller';

describe('production session cookie contract', () => {
  it('issues host-only HttpOnly cookies and clears the original scopes on logout', async () => {
    const expires = new Date('2026-11-24T09:00:00Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(expires.getTime() - 3_600_000);
    const setOptions = new Map<string, CookieOptions>();
    const clearOptions = new Map<string, CookieOptions>();
    const auth = {
      login: () => Promise.resolve({
        mfaRequired: false,
        user: { id: 'fixture' },
        accessToken: '',
        refreshToken: '',
        refreshExpiresAt: expires,
      }),
      logout: jest.fn(() => Promise.resolve()),
    };
    const response = {
      cookie: (name: string, _value: string, options: CookieOptions) => {
        setOptions.set(name, options);
      },
      clearCookie: (name: string, options: CookieOptions) => { clearOptions.set(name, options); },
    };
    const controller = new AuthController(auth as never, new ConfigService({ NODE_ENV: 'production' }));
    try {
      await controller.login({ email: 'fixture@example.test', password: 'fixture-only' }, '127.0.0.1', response as never);
      await controller.logout({ cookies: { [REFRESH_COOKIE]: '' } } as never, response as never);
    } finally {
      clock.mockRestore();
    }
    const base = { httpOnly: true, secure: true, sameSite: 'lax' };
    expect(setOptions.get(ACCESS_COOKIE)).toEqual({ ...base, path: '/' });
    expect(setOptions.get(REFRESH_COOKIE)).toEqual({
      ...base, path: '/api/v1/auth', expires, maxAge: 3_600_000,
    });
    expect(clearOptions.get(ACCESS_COOKIE)).toEqual({ ...base, path: '/' });
    expect(clearOptions.get(REFRESH_COOKIE)).toEqual({ ...base, path: '/api/v1/auth' });
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
