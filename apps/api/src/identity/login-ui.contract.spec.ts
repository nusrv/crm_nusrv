import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('production login UI contract', () => {
  it('contains only email/password credential fields and no manual CAPTCHA token field', () => {
    const source = readFileSync(
      join(process.cwd(), '..', 'web', 'components', 'login-form.tsx'),
      'utf8',
    );
    const fieldNames = [...source.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(fieldNames).toEqual(['email', 'password']);
    expect(source).toContain('Email');
    expect(source).toContain('Password');
    expect(source).toContain('Sign in');
    expect(source).not.toMatch(/captchaToken|CAPTCHA token/i);
  });
});
