import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { CommunicationThreadsController } from './communication-threads.controller';

function methodRoles(controller: Type<unknown>, methodName: string): string[] | undefined {
  const method = Object.getOwnPropertyDescriptor(controller.prototype, methodName)?.value as unknown;
  if (typeof method !== 'function') throw new Error(`Missing controller method ${methodName}.`);
  return Reflect.getMetadata(REQUIRED_ROLES_KEY, method) as string[] | undefined;
}

function allowed(required: string[], role: string): boolean {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }),
  } as unknown as ExecutionContext;
  return new RolesGuard(reflector).canActivate(context);
}

describe('Communication Center RBAC (§20)', () => {
  it('list has no extra role restriction — any authenticated internal user', () => {
    expect(methodRoles(CommunicationThreadsController, 'list') ?? []).toEqual([]);
  });

  it('detail has no extra role restriction — any authenticated internal user', () => {
    expect(methodRoles(CommunicationThreadsController, 'detail') ?? []).toEqual([]);
  });

  it('restricts resolving a thread to ADMIN + SALES_DEVELOPMENT only', () => {
    const roles = methodRoles(CommunicationThreadsController, 'resolve') ?? [];
    expect(roles).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(true);
    for (const role of ['ACCOUNTANT', 'IT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });

  it('restricts sending an operator reply to ADMIN + SALES_DEVELOPMENT only', () => {
    const roles = methodRoles(CommunicationThreadsController, 'reply') ?? [];
    expect(roles).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(true);
    for (const role of ['ACCOUNTANT', 'IT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });

  it('Slice F §9/§16 — restricts generating a suggested reply draft to ADMIN + SALES_DEVELOPMENT only', () => {
    const roles = methodRoles(CommunicationThreadsController, 'draftReply') ?? [];
    expect(roles).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(true);
    for (const role of ['ACCOUNTANT', 'IT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });
});
