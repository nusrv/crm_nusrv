import type { FawtaraGateway } from './fawtara-boundary';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
export const JOFOTARA_ENDPOINT = 'https://backend.jofotara.gov.jo/core/invoices/';
const schema = z.object({
  EINV_SIGNED_INVOICE: z.string().max(1400000).nullish(),
  EINV_SINGED_INVOICE: z.string().max(1400000).nullish(),
  EINV_STATUS: z.enum(['SUBMITTED', 'ALREADY_SUBMITTED', 'NOT_SUBMITTED']),
  EINV_RESULTS: z.record(z.string(), z.unknown()),
  EINV_MESSAGE: z.string().nullish(),
  EINV_QR: z.string().max(60000).nullish(),
  EINV_NUM: z.string().max(191).nullish(),
  EINV_INV_UUID: z.string().max(191).nullish(),
});
export class JoFotaraError extends Error {
  constructor(
    readonly classification: 'TIMEOUT' | 'NETWORK' | 'MALFORMED_RESPONSE' | 'IDENTITY_MISMATCH',
    readonly httpStatus?: number,
  ) {
    super(
      `JoFotara ${classification}. Submission outcome may be unknown; do not create a replacement invoice.`,
    );
  }
}
/** One POST only; no redirects, background retries, credentials in request body, or raw errors. */
@Injectable()
export class JoFotaraGateway implements FawtaraGateway {
  async submit(encodedUblInvoice: string, credentials: { clientId: string; secretKey: string }) {
    let response: Response;
    try {
      response = await fetch(JOFOTARA_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Client-Id': credentials.clientId,
          'Secret-Key': credentials.secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ invoice: encodedUblInvoice }),
      });
    } catch (e) {
      throw new JoFotaraError(
        typeof e === 'object' &&
          e !== null &&
          'name' in e &&
          (e.name === 'TimeoutError' || e.name === 'AbortError')
          ? 'TIMEOUT'
          : 'NETWORK',
      );
    }
    let value: unknown;
    try {
      const text = await response.text();
      if (text.length > 1000000) throw new Error();
      value = JSON.parse(text);
    } catch (e) {
      throw new JoFotaraError(
        typeof e === 'object' &&
          e !== null &&
          'name' in e &&
          (e.name === 'TimeoutError' || e.name === 'AbortError')
          ? 'TIMEOUT'
          : 'MALFORMED_RESPONSE',
        response.status,
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new JoFotaraError('MALFORMED_RESPONSE', response.status);
    const d = parsed.data;
    if (
      d.EINV_STATUS !== 'NOT_SUBMITTED' &&
      (!response.ok || !d.EINV_QR?.trim() || !d.EINV_NUM?.trim() || !d.EINV_INV_UUID?.trim())
    )
      throw new JoFotaraError('MALFORMED_RESPONSE', response.status);
    // Defensive redaction of any reflected credential, including nested diagnostic strings/keys.
    const scrub = (v: unknown): unknown => {
      if (typeof v === 'string')
        return [credentials.clientId, credentials.secretKey].reduce(
          (s, secret) => (secret ? s.split(secret).join('[REDACTED]') : s),
          v,
        );
      if (Array.isArray(v)) return v.map(scrub);
      if (v && typeof v === 'object')
        return Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !/(secret|client.?id|authorization|headers)/i.test(k))
            .map(([k, a]) => [k, scrub(a)]),
        );
      return v;
    };
    for (const v of [d.EINV_NUM, d.EINV_INV_UUID, d.EINV_QR]) {
      if (
        v &&
        [credentials.clientId, credentials.secretKey].some((secret) => secret && v.includes(secret))
      )
        throw new JoFotaraError('MALFORMED_RESPONSE', response.status);
    }
    return {
      signedInvoice: d.EINV_SIGNED_INVOICE ?? d.EINV_SINGED_INVOICE ?? undefined,
      httpStatus: response.status,
      status: d.EINV_STATUS,
      number: d.EINV_NUM ?? null,
      uuid: d.EINV_INV_UUID ?? null,
      qr: d.EINV_QR ?? null,
      message: scrub(d.EINV_MESSAGE ?? null) as string | null,
      results: scrub(d.EINV_RESULTS) as Record<string, unknown>,
    };
  }
}
