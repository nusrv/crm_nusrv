import { hasAsciiControl } from './mail-ascii-control';
/** Inert P2 operator-resolution contract; not a controller or database adapter. */
export interface ResolutionActorContext {
  actorId: string;
  sessionId: string;
  /** Server-verified access JWT expiration, when invoked through HTTP. */
  accessExpiresAt?: number;
}

export interface CurrentResolutionActor extends ResolutionActorContext {
  active: boolean;
  roles: readonly string[];
  sessionUserId: string;
  sessionCreatedAt: Date;
  sessionExpiresAt: Date;
  sessionRevokedAt: Date | null;
}

export interface ResolutionTask {
  id: string;
  status: 'OPEN' | 'RESOLVED';
  revision: number;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
}

type ResolutionCommand = { taskId: string; expectedRevision: number; reason: string };
type ResolutionChange = { status: 'RESOLVED'; revision: number; resolvedById: string; resolvedAt: Date; resolutionReason: string };
type ResolutionAudit = {
  actorType: 'USER'; actorId: string; eventKey: 'mail.dsn.follow_up.resolved';
  subjectType: 'MailDsnFollowUp'; subjectId: string;
  oldState: { status: 'OPEN'; revision: number };
  newState: ResolutionChange;
};
export type ResolutionResult =
  | { outcome: 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'NO_CHANGE' }
  | { outcome: 'RESOLVED'; revision: number };

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 36 &&
    value === value.trim() && !hasAsciiControl(value) && !/[\ud800-\udfff]/u.test(value);
}
function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < 2_147_483_647;
}
function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string' || hasAsciiControl(value) || /[\ud800-\udfff]/u.test(value)) return null;
  const reason = value.trim();
  return reason.length > 0 && reason.length <= 500 ? reason : null;
}
function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : NaN;
}
function isAuthorized(actor: CurrentResolutionActor | null, context: ResolutionActorContext, now: number): actor is CurrentResolutionActor {
  if (!actor || !Number.isFinite(now) || actor.active !== true || !Array.isArray(actor.roles) ||
      !actor.roles.includes('ADMIN') || actor.actorId !== context.actorId || actor.sessionId !== context.sessionId ||
      actor.sessionUserId !== context.actorId || actor.sessionRevokedAt !== null) return false;
  if (context.accessExpiresAt !== undefined && (!Number.isSafeInteger(context.accessExpiresAt) || now >= context.accessExpiresAt)) return false;
  const start = time(actor.sessionCreatedAt);
  const expiry = time(actor.sessionExpiresAt);
  return Number.isFinite(start) && Number.isFinite(expiry) && start <= now && now < Math.min(expiry, start + 86_400_000);
}

/** All methods must use ONE transaction, with current user/session/role locks before task lock.
 * Auth context comes from a verified server-side access token, NEVER the HTTP request body.
 * The adapter must serialize account/role/session revocation with authorization and commit.
 * Throwing (including failed audit) must roll back all writes. No mail or case-state operations.
 */
export interface ResolutionTransaction {
  lockCurrentActor(context: ResolutionActorContext): Promise<CurrentResolutionActor | null>;
  lockTask(taskId: string): Promise<ResolutionTask | null>;
  compareAndResolve(taskId: string, expectedRevision: number, change: ResolutionChange): Promise<number>;
  appendAudit(event: ResolutionAudit): Promise<void>;
}
export interface ResolutionStore {
  transaction<T>(operation: (tx: ResolutionTransaction) => Promise<T>): Promise<T>;
}

/** Resolve once, with an exact same-actor retry returning NO_CHANGE rather than another audit. */
export async function resolveDsnFollowUp(
  store: ResolutionStore, context: ResolutionActorContext, input: unknown, clock: () => Date,
): Promise<ResolutionResult> {
  if (!context || !identity(context.actorId) || !identity(context.sessionId)) return { outcome: 'FORBIDDEN' };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'expectedRevision,reason,taskId') return { outcome: 'INVALID_REQUEST' };
  const raw = input as Partial<ResolutionCommand>;
  const reason = cleanReason(raw.reason);
  if (!identity(raw.taskId) || !validRevision(raw.expectedRevision) || reason === null) return { outcome: 'INVALID_REQUEST' };
  const taskId = raw.taskId;
  const expectedRevision = raw.expectedRevision;
  return store.transaction(async (tx) => {
    const actor = await tx.lockCurrentActor(context);
    if (!isAuthorized(actor, context, time(clock()))) return { outcome: 'FORBIDDEN' };
    const task = await tx.lockTask(taskId);
    if (!task) return { outcome: 'NOT_FOUND' };
    const now = clock();
    if (!isAuthorized(actor, context, time(now))) return { outcome: 'FORBIDDEN' };
    if (task.id !== taskId || !validRevision(task.revision)) return { outcome: 'CONFLICT' };
    if (task.status === 'RESOLVED') {
      if (task.revision === expectedRevision + 1 && task.resolvedById === actor.actorId &&
          task.resolutionReason === reason && Number.isFinite(time(task.resolvedAt))) return { outcome: 'NO_CHANGE' };
      return { outcome: 'CONFLICT' };
    }
    if (task.status !== 'OPEN' || task.revision !== expectedRevision || task.resolvedById !== null ||
        task.resolvedAt !== null || task.resolutionReason !== null) return { outcome: 'CONFLICT' };
    const change: ResolutionChange = { status: 'RESOLVED', revision: task.revision + 1,
      resolvedById: actor.actorId, resolvedAt: now, resolutionReason: reason };
    const count = await tx.compareAndResolve(taskId, expectedRevision, change);
    if (count === 0) return { outcome: 'CONFLICT' };
    if (count !== 1) throw new Error('Unexpected follow-up update count; roll back.');
    await tx.appendAudit({ actorType: 'USER', actorId: actor.actorId, eventKey: 'mail.dsn.follow_up.resolved',
      subjectType: 'MailDsnFollowUp', subjectId: taskId,
      oldState: { status: 'OPEN', revision: expectedRevision }, newState: change });
    return { outcome: 'RESOLVED', revision: change.revision };
  });
}
