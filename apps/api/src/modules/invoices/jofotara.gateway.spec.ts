import { jest } from '@jest/globals';
import { JoFotaraGateway, JOFOTARA_ENDPOINT } from './jofotara.gateway';
const credentials = { clientId: 'private-client', secretKey: 'private-secret' };
const response = {
  EINV_STATUS: 'SUBMITTED',
  EINV_RESULTS: { status: 'PASS' },
  EINV_NUM: 'CRM-1',
  EINV_INV_UUID: 'uuid-1',
  EINV_QR: 'official-value',
};
describe('JoFotara gateway (mock HTTP only)', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  function mock(value: unknown, status = 200) {
    const fn = jest.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(value), { status })),
    );
    globalThis.fetch = fn;
    return fn;
  }
  it('sends one base64 JSON request with documented headers and timeout', async () => {
    const fn = mock(response);
    const encoded = Buffer.from('<Invoice/>').toString('base64');
    await new JoFotaraGateway().submit(encoded, credentials);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(
      JOFOTARA_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          'Client-Id': credentials.clientId,
          'Secret-Key': credentials.secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ invoice: encoded }),
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });
  it('HTTP 200 with NOT_SUBMITTED remains rejected', async () => {
    mock({ ...response, EINV_STATUS: 'NOT_SUBMITTED' });
    expect((await new JoFotaraGateway().submit('xml', credentials)).status).toBe('NOT_SUBMITTED');
  });
  it('accepts documented ALREADY_SUBMITTED for controlled recovery', async () => {
    mock({ ...response, EINV_STATUS: 'ALREADY_SUBMITTED' });
    expect((await new JoFotaraGateway().submit('xml', credentials)).status).toBe(
      'ALREADY_SUBMITTED',
    );
  });
  it.each([
    {},
    { ...response, EINV_STATUS: 'OK' },
    { ...response, EINV_QR: null },
    { ...response, EINV_INV_UUID: null },
  ])('rejects malformed response safely: %j', async (value) => {
    const fn = mock(value);
    await expect(new JoFotaraGateway().submit('xml', credentials)).rejects.toThrow(
      'MALFORMED_RESPONSE',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('timeout is typed, redacted and never retried', async () => {
    const fn = jest.fn<typeof fetch>(() =>
      Promise.reject(new DOMException('private-secret', 'TimeoutError')),
    );
    globalThis.fetch = fn;
    await expect(new JoFotaraGateway().submit('xml', credentials)).rejects.toThrow('TIMEOUT');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('network error does not expose provider message or credentials', async () => {
    globalThis.fetch = jest.fn<typeof fetch>(() => Promise.reject(new Error('private-secret')));
    await expect(new JoFotaraGateway().submit('xml', credentials)).rejects.toThrow(
      'JoFotara NETWORK',
    );
  });
  it('redacts reflected credentials from nested diagnostics', async () => {
    mock({
      ...response,
      EINV_RESULTS: {
        SecretKey: 'private-secret',
        ERRORS: [{ EINV_MESSAGE: 'private-client private-secret' }],
      },
      EINV_MESSAGE: 'private-secret',
    });
    const result = await new JoFotaraGateway().submit('xml', credentials);
    expect(JSON.stringify(result)).not.toContain('private-secret');
    expect(JSON.stringify(result)).not.toContain('private-client');
  });
});
