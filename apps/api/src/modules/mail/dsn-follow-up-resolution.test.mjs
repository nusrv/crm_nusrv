import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDsnFollowUp } from './dsn-follow-up-resolution.ts';

const instant = new Date('2026-11-25T10:00:00Z');
const clock = () => new Date(instant);
const context = { actorId: 'admin-1', sessionId: 'session-1' };
const actor = { ...context, active: true, roles: ['ADMIN'], sessionUserId: context.actorId,
  sessionCreatedAt: new Date(instant.getTime() - 1000), sessionExpiresAt: new Date(instant.getTime() + 1000), sessionRevokedAt: null };
const open = { id: 'task-1', status: 'OPEN', revision: 1, resolvedById: null, resolvedAt: null, resolutionReason: null };
const command = { taskId: open.id, expectedRevision: 1, reason: 'Reviewed provider report' };
function store({ currentActor = actor, task = open, count = 1, failAudit = false } = {}) {
  const calls = []; const audits = []; let row = structuredClone(task);
  return { calls, audits, row: () => row,
    async transaction(operation) {
      calls.push('transaction'); const old = structuredClone(row); const oldCount = audits.length;
      try { return await operation({
        async lockCurrentActor(c) { calls.push('actor'); assert.equal(c.actorId, context.actorId); assert.equal(c.sessionId, context.sessionId); return currentActor; },
        async lockTask(id) { calls.push('task'); assert.equal(id, open.id); return row; },
        async compareAndResolve(id, version, change) { calls.push('update'); assert.equal(id, open.id); assert.equal(version, 1);
          if (count === 1) row = { ...row, ...change }; return count; },
        async appendAudit(event) { calls.push('audit'); if (failAudit) throw Error('audit failed'); audits.push(event); },
      }); } catch (error) { row = old; audits.length = oldCount; throw error; }
    },
  };
}
const run = (s, input = command, auth = context, now = clock) => resolveDsnFollowUp(s, auth, input, now);

test('ADMIN resolves a matching open revision with one atomic audit and no other effects', async () => {
  const s = store(); assert.deepEqual(await run(s), { outcome: 'RESOLVED', revision: 2 });
  assert.deepEqual(s.calls, ['transaction', 'actor', 'task', 'update', 'audit']);
  assert.deepEqual(s.row(), { ...open, status: 'RESOLVED', revision: 2, resolvedById: context.actorId, resolvedAt: instant, resolutionReason: command.reason });
  assert.deepEqual(s.audits[0], { actorType: 'USER', actorId: context.actorId, eventKey: 'mail.dsn.follow_up.resolved', subjectType: 'MailDsnFollowUp', subjectId: open.id,
    oldState: { status: 'OPEN', revision: 1 }, newState: { status: 'RESOLVED', revision: 2, resolvedById: context.actorId, resolvedAt: instant, resolutionReason: command.reason } });
});
test('invalid inputs including body-supplied actor and send actions never start a transaction', async () => {
  for (const input of [null, [], { ...command, actorId: 'admin-2' }, { ...command, resend: true },
    { ...command, reason: ' ' }, { ...command, reason: 'x'.repeat(501) }, { ...command, reason: 'x\r\n' },
    { ...command, expectedRevision: '1' }, { ...command, expectedRevision: 0 }, { ...command, taskId: '' }]) {
    const s = store(); assert.deepEqual(await run(s, input), { outcome: 'INVALID_REQUEST' }); assert.equal(s.calls.length, 0);
  }
});
test('current user, ADMIN role, session ownership, revocation and 24-hour limit all fail closed', async () => {
  for (const currentActor of [null, { ...actor, active: false }, { ...actor, roles: ['MANAGER', 'ACCOUNTANT'] },
    { ...actor, actorId: 'other' }, { ...actor, sessionId: 'other' }, { ...actor, sessionUserId: 'other' },
    { ...actor, sessionRevokedAt: instant }, { ...actor, sessionExpiresAt: instant },
    { ...actor, sessionCreatedAt: new Date(instant.getTime() - 86_400_000) }, { ...actor, sessionExpiresAt: 'bad' }]) {
    const s = store({ currentActor }); assert.deepEqual(await run(s), { outcome: 'FORBIDDEN' });
    assert.deepEqual(s.calls, ['transaction', 'actor']);
  }
});
test('session expiration during task lock is checked again before write', async () => {
  const s = store(); let reads = 0;
  assert.deepEqual(await run(s, command, context, () => new Date(instant.getTime() + (reads++ ? 1000 : 0))), { outcome: 'FORBIDDEN' });
  assert.deepEqual(s.calls, ['transaction', 'actor', 'task']);
});
test('missing, stale, corrupt and CAS-lost tasks cannot create an audit', async () => {
  for (const [task, expected] of [[null, 'NOT_FOUND'], [{ ...open, revision: 2 }, 'CONFLICT'],
    [{ ...open, resolvedById: 'unexpected' }, 'CONFLICT'], [{ ...open, id: 'other' }, 'CONFLICT']]) {
    const s = store({ task }); assert.deepEqual(await run(s), { outcome: expected }); assert.equal(s.audits.length, 0);
  }
  const s = store({ count: 0 }); assert.deepEqual(await run(s), { outcome: 'CONFLICT' }); assert.equal(s.audits.length, 0);
});
test('same authorized request replay does not reopen or write a second audit', async () => {
  const s = store(); await run(s); assert.deepEqual(await run(s), { outcome: 'NO_CHANGE' }); assert.equal(s.audits.length, 1);
  assert.deepEqual(await run(s, { ...command, reason: 'different' }), { outcome: 'CONFLICT' });
  assert.deepEqual(await run(s, { ...command, expectedRevision: 2 }), { outcome: 'CONFLICT' });
  assert.equal(s.audits.length, 1);
});
test('audit failure and impossible update count throw so the transaction rolls back', async () => {
  for (const options of [{ failAudit: true }, { count: 2 }]) {
    const s = store(options); await assert.rejects(run(s)); assert.deepEqual(s.row(), open); assert.equal(s.audits.length, 0);
  }
});

test('HTTP access expiry is rechecked after transaction locking', async () => {
  const s = store(); let reads = 0;
  const auth = { ...context, accessExpiresAt: instant.getTime() + 200 };
  assert.deepEqual(await run(s, command, auth, () => new Date(instant.getTime() + (reads++ ? 200 : 0))), { outcome: 'FORBIDDEN' });
  assert.deepEqual(s.calls, ['transaction', 'actor', 'task']);
  assert.equal(s.audits.length, 0);
});
