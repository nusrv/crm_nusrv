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
});
