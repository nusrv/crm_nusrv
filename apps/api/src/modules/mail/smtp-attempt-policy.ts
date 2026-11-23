export type MailAcceptance =
  | { source: 'smtp'; responseCode: number; providerQueueId?: string }
  | { source: 'mock' };

export class SmtpNotStartedError extends Error {
  readonly code = 'ECONNECTION';
}

export const UNCERTAIN_SMTP = 'SMTP outcome uncertain; automatic replay suppressed.';

export function smtpAcceptance(info: { accepted?: unknown; response?: unknown }, recipient: string): MailAcceptance | undefined {
  if (typeof info.response !== 'string' || !/^2\d{2}(?:[ -]|$)/.test(info.response)) return;
  if (Array.isArray(info.accepted) &&
      info.accepted.some((address) => typeof address === 'string' &&
        address.toLowerCase() === recipient.toLowerCase())) {
    const providerQueueId = /\bqueued as ([A-Za-z0-9._:-]{1,100})(?:\s|$)/i.exec(info.response)?.[1];
    return {
      source: 'smtp',
      responseCode: Number(info.response.slice(0, 3)),
      ...(providerQueueId ? { providerQueueId } : {}),
    };
  }
}

export function smtpFailure(error: unknown) {
  if (error instanceof SmtpNotStartedError) return { outcome: 'not_started' as const };
  const value = (typeof error === 'object' && error !== null ? error : {}) as {
    responseCode?: unknown;
    command?: unknown;
    code?: unknown;
  };
  const command = typeof value.command === 'string' ? value.command.toUpperCase() : '';
  // Nodemailer can label a lost connection CONN even after it has streamed DATA.
  const authentication = command === 'AUTH' || command.startsWith('AUTH ');
  if (authentication && value.code === 'EAUTH' && typeof value.responseCode !== 'number') {
    return { outcome: 'not_started' as const };
  }
  if (typeof value.responseCode === 'number' && Number.isInteger(value.responseCode) &&
      value.responseCode >= 400 && value.responseCode < 600 &&
      ((authentication && value.code === 'EAUTH') ||
        (['DATA', 'RCPT TO', 'MAIL FROM'].includes(command) &&
          (value.code === 'EENVELOPE' || value.code === 'EMESSAGE')))) {
    return { outcome: 'rejected' as const, responseCode: value.responseCode };
  }
  return { outcome: 'uncertain' as const };
}

export function replayEligible(now: Date) {
  return {
    status: 'QUEUED' as const,
    smtpUncertain: false,
    OR: [{ attempts: 0 }, { smtpRetrySafe: true }],
    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
  };
}

export function quarantineEligible(staleBefore: Date) {
  return {
    OR: [
      { status: 'PROCESSING' as const, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: staleBefore } }] },
      {
        status: 'QUEUED' as const,
        smtpRetrySafe: false,
        attempts: { gt: 0 },
      },
    ],
  };
}

type AttemptResult =
  | { accepted: true; acceptance: MailAcceptance }
  | { accepted: false; error: unknown };

/** Persist the attempt boundary first. Persistence failure after send leaves it quarantinable. */
export async function dispatchSmtp(
  begin: () => Promise<string | null>,
  send: () => Promise<MailAcceptance | void>,
  record: (attemptId: string, result: AttemptResult) => Promise<boolean>,
): Promise<'conflict' | 'sent' | 'failed' | 'ownership_lost_after_send'> {
  const attemptId = await begin();
  if (!attemptId) return 'conflict';
  let result: AttemptResult;
  try {
    const acceptance = await send();
    result = acceptance
      ? { accepted: true, acceptance }
      : { accepted: false, error: undefined };
  } catch (error) {
    result = { accepted: false, error };
  }
  const recorded = await record(attemptId, result);
  return recorded ? (result.accepted ? 'sent' : 'failed') : 'ownership_lost_after_send';
}
