import type { ActorType } from '../generated/prisma/enums';

export interface RecordAuditEvent {
  actorType: ActorType;
  actorId?: string;
  eventKey: string;
  subjectType: string;
  subjectId: string;
  oldState?: unknown;
  newState?: unknown;
  metadata?: unknown;
  ipAddress?: string;
}
