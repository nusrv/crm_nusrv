import type { AuthenticatedUser } from '@cp/shared';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
