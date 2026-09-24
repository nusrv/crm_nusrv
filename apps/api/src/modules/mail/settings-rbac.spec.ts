import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { AiSettingsController } from '../ai/ai-settings.controller';
import { MailSettingsController } from './mail-settings.controller';

function methodRoles(controller: Type<unknown>, methodName: string): string[] {
  const method = Object.getOwnPropertyDescriptor(controller.prototype, methodName)?.value as unknown;
  if (typeof method !== 'function') throw new Error(`Missing controller method ${methodName}.`);
  return (Reflect.getMetadata(REQUIRED_ROLES_KEY, method) as string[] | undefined) ?? [];
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

const NON_ADMIN_ROLES = ['ACCOUNTANT', 'SALES_DEVELOPMENT', 'MANAGEMENT'];

describe('Phase 3.1 §N — Mail/AI Settings RBAC', () => {
  describe('MailSettingsController', () => {
    it('ADMIN and IT may view (list/findOne); no other role may', () => {
      for (const method of ['list', 'findOne']) {
        const roles = methodRoles(MailSettingsController, method);
        expect(roles).toEqual(['ADMIN', 'IT']);
        expect(allowed(roles, 'ADMIN')).toBe(true);
        expect(allowed(roles, 'IT')).toBe(true);
        for (const role of NON_ADMIN_ROLES) expect(allowed(roles, role)).toBe(false);
      }
    });

    it('only ADMIN may create/update/test-imap/test-smtp — IT and every other role are denied', () => {
      for (const method of ['create', 'update', 'testImap', 'testSmtp']) {
        const roles = methodRoles(MailSettingsController, method);
        expect(roles).toEqual(['ADMIN']);
        expect(allowed(roles, 'ADMIN')).toBe(true);
        expect(allowed(roles, 'IT')).toBe(false);
        for (const role of NON_ADMIN_ROLES) expect(allowed(roles, role)).toBe(false);
      }
    });
  });

  describe('AiSettingsController', () => {
    it('ADMIN and IT may view (get); no other role may', () => {
      const roles = methodRoles(AiSettingsController, 'get');
      expect(roles).toEqual(['ADMIN', 'IT']);
      expect(allowed(roles, 'ADMIN')).toBe(true);
      expect(allowed(roles, 'IT')).toBe(true);
      for (const role of NON_ADMIN_ROLES) expect(allowed(roles, role)).toBe(false);
    });

    it('only ADMIN may update/test/discover-models — IT and every other role are denied', () => {
      for (const method of ['update', 'test', 'discoverModels']) {
        const roles = methodRoles(AiSettingsController, method);
        expect(roles).toEqual(['ADMIN']);
        expect(allowed(roles, 'ADMIN')).toBe(true);
        expect(allowed(roles, 'IT')).toBe(false);
        for (const role of NON_ADMIN_ROLES) expect(allowed(roles, role)).toBe(false);
      }
    });
  });
});
