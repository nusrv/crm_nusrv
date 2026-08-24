import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextWithRoles(roles: string[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows an explicitly authorized role', () => {
    const reflector = { getAllAndOverride: () => ['ACCOUNTANT'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextWithRoles(['ACCOUNTANT']))).toBe(true);
  });

  it('denies a role outside the required permission set', () => {
    const reflector = { getAllAndOverride: () => ['IT'] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextWithRoles(['SALES_DEVELOPMENT']))).toBe(
      false,
    );
  });

  it('permits authenticated endpoints without role metadata', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextWithRoles([]))).toBe(true);
  });
});
