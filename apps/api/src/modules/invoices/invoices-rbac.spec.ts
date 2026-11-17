import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { RolesGuard } from '../../identity/roles.guard';
import { InvoicesController } from './invoices.controller';

function allowed(required: string[], role: string): boolean {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => InvoicesController,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }),
  } as unknown as ExecutionContext;
  return new RolesGuard(reflector).canActivate(context);
}

describe('invoice RBAC', () => {
  it('restricts every invoice endpoint to human ADMIN and ACCOUNTANT roles', () => {
    const roles = Reflect.getMetadata(REQUIRED_ROLES_KEY, InvoicesController) as string[];
    expect(roles).toEqual(['ADMIN', 'ACCOUNTANT']);
    expect(allowed(roles, 'ADMIN')).toBe(true);
    expect(allowed(roles, 'ACCOUNTANT')).toBe(true);
    for (const role of ['IT', 'SALES_DEVELOPMENT', 'MANAGEMENT']) {
      expect(allowed(roles, role)).toBe(false);
    }
  });

  it('has no worker, scheduler, or AI endpoint that can officialize an invoice', () => {
    const methods = Object.getOwnPropertyNames(InvoicesController.prototype);
    expect(methods).toContain('recordFawtaraResult');
    expect(methods).not.toEqual(
      expect.arrayContaining(['processJob', 'routeAi', 'scheduledSubmit']),
    );
  });
});
