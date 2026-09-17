/** Slice E §21 — audit event keys. Safe metadata only (ids, actorId) — never email body,
 * credentials, raw AI prompt, or an API key. */
export const COMMUNICATION_AUDIT_EVENT = {
  REPLY_QUEUED: 'communication.reply.queued',
  REPLY_SEND_FAILED: 'communication.reply.send_failed',
  THREAD_RESOLVED: 'communication.thread.resolved',
} as const;
