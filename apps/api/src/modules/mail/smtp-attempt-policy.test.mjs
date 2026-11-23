import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  dispatchSmtp,
  quarantineEligible,
  replayEligible,
  smtpAcceptance,
  smtpFailure,
  SmtpNotStartedError,
} from './smtp-attempt-policy.ts';

test('SMTP proof distinguishes recipient acceptance, explicit rejection and uncertainty', () => {
  assert.deepEqual(smtpAcceptance({ accepted: ['customer@example.test'], response: '250 queued' }, 'customer@example.test'),
    { source: 'smtp', responseCode: 250 });
  assert.deepEqual(smtpAcceptance({ accepted: ['customer@example.test'], response: '250 2.0.0 queued as A12B' }, 'customer@example.test'),
    { source: 'smtp', responseCode: 250, providerQueueId: 'A12B' });
  assert.equal(smtpAcceptance({ accepted: ['other@example.test'], response: '250 queued' }, 'customer@example.test'), undefined);
  assert.equal(smtpAcceptance({ accepted: ['customer@example.test'], response: '354 go ahead' }, 'customer@example.test'), undefined);
  assert.deepEqual(smtpFailure({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }),
    { outcome: 'rejected', responseCode: 550 });
  assert.deepEqual(smtpFailure({ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }),
    { outcome: 'rejected', responseCode: 451 });
  assert.deepEqual(smtpFailure(new SmtpNotStartedError()), { outcome: 'not_started' });
  assert.deepEqual(smtpFailure({ code: 'ETIMEDOUT', command: 'CONN' }), { outcome: 'uncertain' });
  assert.deepEqual(smtpFailure({ code: 'ESOCKET', command: 'CONN' }), { outcome: 'uncertain' });
  assert.deepEqual(smtpFailure({ code: 'ECONNECTION', command: 'CONN' }), { outcome: 'uncertain' });
  assert.deepEqual(smtpFailure({ code: 'ETIMEDOUT', command: 'DATA', responseCode: 451 }), { outcome: 'uncertain' });
  assert.deepEqual(smtpFailure({ code: 'ECONNRESET' }), { outcome: 'uncertain' });
});

test('both workers use a queue-only claim predicate and a separate quarantine predicate', () => {
  const boundary = new Date(10_000);
  assert.deepEqual(replayEligible(boundary), {
    status: 'QUEUED', smtpUncertain: false, OR: [{ attempts: 0 }, { smtpRetrySafe: true }],
    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: boundary } }] }],
  });
  assert.deepEqual(quarantineEligible(boundary), { OR: [
    { status: 'PROCESSING', OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: boundary } }] },
    { status: 'QUEUED', smtpRetrySafe: false, attempts: { gt: 0 } },
  ] });
});

test('concurrent dispatch can only transmit after one durable boundary wins', async () => {
  let began = false;
  let transmissions = 0;
  const begin = async () => {
    if (began) return null;
    began = true;
    return 'attempt-1';
  };
  const send = async () => {
    assert.ok(began);
    transmissions++;
    return { source: 'mock' };
  };
  const record = async (id, evidence) => {
    assert.equal(id, 'attempt-1');
    assert.deepEqual(evidence, { accepted: true, acceptance: { source: 'mock' } });
    return true;
  };
  assert.deepEqual(await Promise.all([dispatchSmtp(begin, send, record), dispatchSmtp(begin, send, record)]), ['sent', 'conflict']);
  assert.equal(transmissions, 1);
});

test('crash after acceptance leaves the attempt fenced and a resend cannot start', async () => {
  let fenced = false;
  let transmissions = 0;
  const begin = async () => {
    if (fenced) return null;
    fenced = true;
    return 'attempt-2';
  };
  const send = async () => {
    transmissions++;
    return { source: 'smtp', responseCode: 250 };
  };
  await assert.rejects(dispatchSmtp(begin, send, async () => { throw new Error('DB interrupted'); }), /DB interrupted/);
  assert.equal(await dispatchSmtp(begin, send, async () => true), 'conflict');
  assert.equal(transmissions, 1);
});

test('ambiguous and missing evidence fail closed, and late proof does not acquire ownership', async () => {
  for (const send of [
    async () => { throw { code: 'ETIMEDOUT', command: 'DATA' }; },
    async () => undefined,
  ]) {
    assert.equal(await dispatchSmtp(async () => 'attempt-3', send, async (id, outcome) => {
      assert.equal(id, 'attempt-3');
      assert.equal(outcome.accepted, false);
      assert.deepEqual(smtpFailure(outcome.error), { outcome: 'uncertain' });
      return true;
    }), 'failed');
  }
  assert.equal(await dispatchSmtp(async () => 'attempt-4', async () => ({ source: 'smtp', responseCode: 250 }),
    async (_id, outcome) => {
      assert.equal(outcome.accepted, true);
      return false;
    }), 'ownership_lost_after_send');
});

test('replay and scheduling migrations add only default-closed state and an independent clock', () => {
  const migrations = new URL('../../../prisma/migrations/', import.meta.url);
  const sql = (name) => readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8')
    .replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim();
  assert.equal(sql('20261122002000_p02_outbound_replay_safety'),
    ['communication_outbox', 'operator_reply_outbox'].map((table) =>
      `ALTER TABLE \`${table}\` ADD COLUMN \`smtp_retry_safe\` BOOLEAN NOT NULL DEFAULT false, ADD COLUMN \`smtp_uncertain\` BOOLEAN NOT NULL DEFAULT false;`,
    ).join(' '));
  assert.equal(sql('20261122003000_p05_notification_attempt_eligibility'),
    'ALTER TABLE `communication_outbox` ADD COLUMN `next_attempt_at` DATETIME(3) NULL, ADD INDEX `communication_outbox_attempt_due_idx` (`status`, `next_attempt_at`, `scheduled_at`);');
});
