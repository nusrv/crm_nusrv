import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@cp/shared';
import { IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './auth.constants';
import type { AuthenticatedRequest } from './auth-user';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // JwtStrategy resolves roles from the current account and session for every protected request.
    if (request.method && !READ_METHODS.has(request.method) && !request.user?.roles.includes('ADMIN')) {
      return false;
    }
    const required = this.reflector.getAllAndOverride<RoleCode[]>(REQUIRED_ROLES_KEY, targets);
    if (!required?.length) return true;
    return required.some((role) => request.user?.roles.includes(role));
  }
}
