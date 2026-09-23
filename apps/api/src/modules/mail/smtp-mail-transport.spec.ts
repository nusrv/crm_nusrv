import { jest } from '@jest/globals';
import {
  SMTP_TIMEOUT_BUDGET_MS,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  STALE_PROCESSING_LEASE_MS,
} from './mail-timing.constants';
import { SmtpMailTransport } from './smtp-mail-transport';

const message = {
  messageId: '<abc@example.test>',
  fromAddress: 'renewals@example.test',
  fromName: 'Renewals',
  toAddress: 'customer@example.test',
  subject: 'Your renewal',
  text: 'Body text',
  headers: { 'X-Renewal-Case-Id': 'case-1' },
};

function fakeTransportFactory(sendMail: jest.Mock, close: jest.Mock) {
  return jest.fn(() => ({ sendMail, close })) as unknown as SmtpMailTransport['transportFactory'];
}

describe('SmtpMailTransport', () => {
  it('decrypts credentials lazily and passes the explicit Message-ID through unchanged', async () => {
    const sendMail = jest.fn(() => Promise.resolve({ messageId: 'ignored' }));
    const close = jest.fn();
    const createTransport = fakeTransportFactory(sendMail, close);
    const decrypt = jest.fn(() => ({ password: 'super-secret' }));
    const transport = new SmtpMailTransport({ decrypt } as never);
    transport.transportFactory = createTransport;

    const config = {
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'renewals',
      smtpCredentialsCiphertext: 'v1.iv.tag.ciphertext',
    };

    await transport.send(message, config as never);

    expect(decrypt).toHaveBeenCalledWith('v1.iv.tag.ciphertext');
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.test',
        port: 587,
        secure: true,
        auth: { user: 'renewals', pass: 'super-secret' },
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: '<abc@example.test>',
        to: 'customer@example.test',
        subject: 'Your renewal',
        text: 'Body text',
        headers: { 'X-Renewal-Case-Id': 'case-1' },
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never decrypts or sets auth when no credential ciphertext is configured', async () => {
    const sendMail = jest.fn(() => Promise.resolve({ messageId: 'ignored' }));
    const close = jest.fn();
    const createTransport = fakeTransportFactory(sendMail, close);
    const decrypt = jest.fn();
    const transport = new SmtpMailTransport({ decrypt } as never);
    transport.transportFactory = createTransport;

    const config = {
      smtpHost: 'smtp.example.test',
      smtpPort: 25,
      smtpSecure: false,
      smtpUsername: 'renewals',
      smtpCredentialsCiphertext: null,
    };

    await transport.send(message, config as never);

    expect(decrypt).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it('still closes the transporter when sendMail rejects', async () => {
    const sendMail = jest.fn(() => Promise.reject(new Error('SMTP 550 rejected')));
    const close = jest.fn();
    const createTransport = fakeTransportFactory(sendMail, close);
    const transport = new SmtpMailTransport({ decrypt: jest.fn() } as never);
    transport.transportFactory = createTransport;

    const config = {
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'renewals',
      smtpCredentialsCiphertext: null,
    };

    await expect(transport.send(message, config as never)).rejects.toThrow('SMTP 550 rejected');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('configures every nodemailer timeout explicitly, with their sum comfortably under the stale-PROCESSING lease', async () => {
    const sendMail = jest.fn(() => Promise.resolve({ messageId: 'ignored' }));
    const close = jest.fn();
    const rawCreateTransport = jest.fn(
      (options: { connectionTimeout?: number; greetingTimeout?: number; socketTimeout?: number }) => {
        void options;
        return { sendMail, close };
      },
    );
    const transport = new SmtpMailTransport({ decrypt: jest.fn() } as never);
    transport.transportFactory = rawCreateTransport as unknown as SmtpMailTransport['transportFactory'];

    await transport.send(message, {
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'renewals',
      smtpCredentialsCiphertext: null,
    } as never);

    const options = rawCreateTransport.mock.calls[0]![0];
    expect(typeof options.connectionTimeout).toBe('number');
    expect(typeof options.greetingTimeout).toBe('number');
    expect(typeof options.socketTimeout).toBe('number');
    const configuredMax = options.connectionTimeout! + options.greetingTimeout! + options.socketTimeout!;
    expect(configuredMax).toBe(SMTP_TIMEOUT_BUDGET_MS);
    expect(configuredMax).toBeLessThan(STALE_PROCESSING_LEASE_MS);
  });

  describe('MICROSOFT_OAUTH2 credentials', () => {
    // Deliberately NOT cast to MicrosoftOAuthTokenProvider here — keeping it a plain object literal
    // lets `expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(...)` reference the mock
    // directly (casting to the class type makes ESLint's unbound-method rule flag it, since a real
    // class method detached from its instance is genuinely unsafe). The cast happens only at the
    // SmtpMailTransport constructor call site, via `as never`, exactly like `{ decrypt } as never`
    // already does for SecretEncryptionService above.
    function fakeTokenProvider(accessToken = 'access-token-abc') {
      return { getAccessToken: jest.fn(() => Promise.resolve(accessToken)) };
    }

    it('resolves an access token via the token provider and passes OAuth2 auth to nodemailer, never a password', async () => {
      const sendMail = jest.fn(() => Promise.resolve({ messageId: 'ignored' }));
      const close = jest.fn();
      const createTransport = fakeTransportFactory(sendMail, close);
      const decrypt = jest.fn(() => ({
        authMode: 'MICROSOFT_OAUTH2',
        tenantId: 'tenant-1',
        clientId: 'client-1',
        clientSecret: 'super-secret-client-secret',
      }));
      const tokenProvider = fakeTokenProvider('access-token-abc');
      const transport = new SmtpMailTransport({ decrypt } as never, tokenProvider as never);
      transport.transportFactory = createTransport;

      const config = {
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'renewals@example.onmicrosoft.com',
        smtpCredentialsCiphertext: 'v1.iv.tag.ciphertext',
      };

      await transport.send(message, config as never);

      expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ authMode: 'MICROSOFT_OAUTH2', tenantId: 'tenant-1', clientId: 'client-1' }),
      );
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: { type: 'OAuth2', user: 'renewals@example.onmicrosoft.com', accessToken: 'access-token-abc' },
        }),
      );
      const [options] = (createTransport as unknown as jest.Mock).mock.calls[0]! as [Record<string, unknown>];
      expect(JSON.stringify(options)).not.toContain('super-secret-client-secret');
    });

    it('does not call the token provider at all for a BASIC-credentialed configuration', async () => {
      const sendMail = jest.fn(() => Promise.resolve({ messageId: 'ignored' }));
      const close = jest.fn();
      const createTransport = fakeTransportFactory(sendMail, close);
      const decrypt = jest.fn(() => ({ password: 'super-secret' }));
      const tokenProvider = fakeTokenProvider();
      const transport = new SmtpMailTransport({ decrypt } as never, tokenProvider as never);
      transport.transportFactory = createTransport;

      await transport.send(message, {
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpSecure: true,
        smtpUsername: 'renewals',
        smtpCredentialsCiphertext: 'v1.iv.tag.ciphertext',
      } as never);

      expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'renewals', pass: 'super-secret' } }));
    });

    it('propagates a token-provider failure without ever sending mail', async () => {
      const sendMail = jest.fn();
      const close = jest.fn();
      const createTransport = fakeTransportFactory(sendMail, close);
      const decrypt = jest.fn(() => ({ authMode: 'MICROSOFT_OAUTH2', tenantId: 't', clientId: 'c', clientSecret: 's' }));
      const tokenProvider = {
        getAccessToken: jest.fn(() => Promise.reject(new Error('Microsoft OAuth token request rejected (status 401).'))),
      };
      const transport = new SmtpMailTransport({ decrypt } as never, tokenProvider as never);
      transport.transportFactory = createTransport;

      await expect(
        transport.send(message, {
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpSecure: false,
          smtpUsername: 'renewals@example.onmicrosoft.com',
          smtpCredentialsCiphertext: 'v1.iv.tag.ciphertext',
        } as never),
      ).rejects.toThrow('status 401');
      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
