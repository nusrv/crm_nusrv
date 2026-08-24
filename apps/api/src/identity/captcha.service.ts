import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CaptchaProviderResponse {
  success?: boolean;
}

@Injectable()
export class CaptchaService {
  constructor(private readonly config: ConfigService) {}

  async verify(token: string, remoteAddress?: string): Promise<boolean> {
    const provider = this.config.getOrThrow<string>('CAPTCHA_PROVIDER');
    if (provider === 'mock') {
      return (
        this.config.get<string>('NODE_ENV') !== 'production' &&
        token === this.config.getOrThrow<string>('CAPTCHA_TEST_TOKEN')
      );
    }

    const endpoint =
      provider === 'turnstile'
        ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
        : 'https://www.google.com/recaptcha/api/siteverify';
    const body = new URLSearchParams({
      secret: this.config.getOrThrow<string>('CAPTCHA_SECRET'),
      response: token,
    });
    if (remoteAddress) body.set('remoteip', remoteAddress);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const result = (await response.json()) as CaptchaProviderResponse;
      return result.success === true;
    } catch {
      return false;
    }
  }
}
