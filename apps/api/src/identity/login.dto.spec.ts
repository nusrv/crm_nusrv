import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('accepts email and password without captchaToken', async () => {
    const input = Object.assign(new LoginDto(), {
      email: 'admin@example.test',
      password: 'correct-password',
    });
    expect(await validate(input)).toEqual([]);
  });

  it('still rejects an explicitly supplied empty captchaToken', async () => {
    const input = Object.assign(new LoginDto(), {
      email: 'admin@example.test',
      password: 'correct-password',
      captchaToken: '',
    });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'captchaToken' })]),
    );
  });
});
