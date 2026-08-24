import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { RecordAuditEvent } from './audit.types';

const SENSITIVE_KEY = /(authorization|password|secret|token|credential|api.?key)/i;

export function sanitizeAuditValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditValue(entry) ?? null);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : (sanitizeAuditValue(entry) ?? null),
      ]),
    );
  }
  return typeof value === 'bigint' ? value.toString() : '[UNSERIALIZABLE]';
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(event: RecordAuditEvent, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    return client.auditEvent.create({
      data: {
        actorType: event.actorType,
        actorId: event.actorId,
        eventKey: event.eventKey,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        oldState: sanitizeAuditValue(event.oldState),
        newState: sanitizeAuditValue(event.newState),
        metadata: sanitizeAuditValue(event.metadata),
        ipAddress: event.ipAddress,
      },
    });
  }
}
