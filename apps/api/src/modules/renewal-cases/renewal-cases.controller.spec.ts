import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../identity/roles.guard';
import { RenewalCasesController } from './renewal-cases.controller';

type ReadHandler = 'prepare' | 'replies' | 'evidence';

function readContext(handler: ReadHandler, roles: string[]): ExecutionContext {
  return {
    getHandler: () => RenewalCasesController.prototype[handler],
    getClass: () => RenewalCasesController,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', user: { roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('P1 renewal communications read authorization', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(['prepare', 'replies', 'evidence'] as const)(
    'permits only current ADMIN to read %s data',
    (handler) => {
      expect(guard.canActivate(readContext(handler, ['ADMIN']))).toBe(true);
      expect(guard.canActivate(readContext(handler, ['ACCOUNTANT']))).toBe(false);
      expect(guard.canActivate(readContext(handler, ['SALES_DEVELOPMENT']))).toBe(false);
      expect(guard.canActivate(readContext(handler, []))).toBe(false);
    },
  );
});
