import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { ClassificationController } from './classification.controller';

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

describe('Classification review RBAC (§18/§24)', () => {
  it('read (classification history/effective) has no extra role restriction — any authenticated internal user', () => {
    const roles = methodRoles(ClassificationController, 'getClassification');
    expect(roles ?? []).toEqual([]);
  });

  it('restricts review creation to ADMIN + SALES_DEVELOPMENT only', () => {
    const roles = methodRoles(ClassificationController, 'createReview') ?? [];
    expect(roles).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(true);
    for (const role of ['ACCOUNTANT', 'IT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });
});
