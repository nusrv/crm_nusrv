import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../identity/auth.constants';
import { RolesGuard } from '../identity/roles.guard';
import { CustomersController } from './customers/customers.controller';
import { LegacyImportController } from './legacy-import/legacy-import.controller';
import { TechnicalConnectionsController } from './technical-connections/technical-connections.controller';

function context(userRoles: string[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ user: { roles: userRoles } }) }),
  } as unknown as ExecutionContext;
}

function methodRoles(controller: Type<unknown>, methodName: string): string[] {
  const method = Object.getOwnPropertyDescriptor(controller.prototype, methodName)
    ?.value as unknown;
  if (typeof method !== 'function') throw new Error(`Missing controller method ${methodName}.`);
  return Reflect.getMetadata(REQUIRED_ROLES_KEY, method) as string[];
}

function expectRoleAccess(required: string[], role: string, allowed: boolean): void {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  expect(new RolesGuard(reflector).canActivate(context([role]))).toBe(allowed);
}

describe('Phase 1 RBAC metadata and enforcement', () => {
  it('restricts customer mutation to Admin and Sales Development', () => {
    expect(methodRoles(CustomersController, 'create')).toEqual(['ADMIN', 'SALES_DEVELOPMENT']);
  });

  it.each(['list', 'findOne'])('restricts Technical Connection %s to Admin and IT', (method) => {
    const required = methodRoles(TechnicalConnectionsController, method);
    expect(required).toEqual(['ADMIN', 'IT']);
    expectRoleAccess(required, 'ADMIN', true);
    expectRoleAccess(required, 'IT', true);
    expectRoleAccess(required, 'ACCOUNTANT', false);
    expectRoleAccess(required, 'SALES_DEVELOPMENT', false);
    expectRoleAccess(required, 'MANAGEMENT', false);
  });

  it('restricts Technical Connection mutation to Admin and IT', () => {
    expect(methodRoles(TechnicalConnectionsController, 'create')).toEqual(['ADMIN', 'IT']);
  });

  it('rejects unauthorized import approval', () => {
    const required = methodRoles(LegacyImportController, 'approveRow');
    expect(required).toEqual(['ADMIN']);
    expectRoleAccess(required, 'ACCOUNTANT', false);
    expectRoleAccess(required, 'ADMIN', true);
  });
});
