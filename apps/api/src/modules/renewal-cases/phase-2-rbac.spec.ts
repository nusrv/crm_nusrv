import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { RenewalCasesController } from './renewal-cases.controller';
import { RenewalConfigurationController } from './renewal-configuration.controller';
import { RenewalEngineController } from './renewal-engine.controller';

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

describe('Phase 2 RBAC', () => {
  it.each(['updateReminderRule', 'updateTemplate', 'updateNotificationRule'])(
    'allows only Admin to %s',
    (method) => {
      const roles = methodRoles(RenewalConfigurationController, method) ?? [];
      expect(roles).toEqual(['ADMIN']);
      expect(allowed(roles, 'ADMIN')).toBe(true);
      for (const role of ['ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT']) {
        expect(allowed(roles, role)).toBe(false);
      }
    },
  );

  it('allows only Admin to queue a manual renewal evaluation', () => {
    const roles = methodRoles(RenewalEngineController, 'run') ?? [];
    expect(roles).toEqual(['ADMIN']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'IT')).toBe(false);
    expect(allowed(roles, 'MANAGEMENT')).toBe(false);
  });

  it.each(['createHold', 'releaseHold'])(
    'allows operational roles except Management to %s',
    (method) => {
      const roles = methodRoles(RenewalCasesController, method) ?? [];
      expect(roles).toEqual(['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT']);
      for (const role of roles) expect(allowed(roles, role)).toBe(true);
      expect(allowed(roles, 'MANAGEMENT')).toBe(false);
    },
  );

  it('keeps renewal case listing available to every authenticated operational role', () => {
    expect(methodRoles(RenewalCasesController, 'list')).toBeUndefined();
  });
});
