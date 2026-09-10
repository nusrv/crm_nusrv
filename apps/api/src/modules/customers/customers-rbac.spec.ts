import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { CustomersController } from './customers.controller';

function methodRoles(controller: Type<unknown>, methodName: string): string[] | undefined {
  const method = Object.getOwnPropertyDescriptor(controller.prototype, methodName)
    ?.value as unknown;
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

describe('Customer lifecycle/RBAC', () => {
  it('allows ADMIN and SALES_DEVELOPMENT to edit ordinary Customer fields via PATCH', () => {
    const roles = methodRoles(CustomersController, 'update') ?? [];
    expect(roles).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(true);
    for (const role of ['ACCOUNTANT', 'IT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });

  it('restricts deactivate to ADMIN only — SALES_DEVELOPMENT cannot deactivate', () => {
    const roles = methodRoles(CustomersController, 'deactivate') ?? [];
    expect(roles).toEqual(['ADMIN']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(false);
  });

  it('restricts reactivate to ADMIN only — SALES_DEVELOPMENT cannot reactivate', () => {
    const roles = methodRoles(CustomersController, 'reactivate') ?? [];
    expect(roles).toEqual(['ADMIN']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'SALES_DEVELOPMENT')).toBe(false);
  });
});
