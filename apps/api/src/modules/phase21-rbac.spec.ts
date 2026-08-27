import { REQUIRED_ROLES_KEY } from '../identity/auth.constants';
import { CustomersController } from './customers/customers.controller';
import { ServicePackagesController } from './service-packages/service-packages.controller';

function roles(target: object, method: string): string[] {
  const handler = (target as Record<string, unknown>)[method];
  const metadata = Reflect.getMetadata(REQUIRED_ROLES_KEY, handler as object) as unknown;
  return Array.isArray(metadata)
    ? metadata.filter((role): role is string => typeof role === 'string')
    : [];
}

describe('Phase 2.1 RBAC', () => {
  it('keeps package reads authenticated globally and package management Admin-only', () => {
    expect(roles(ServicePackagesController.prototype, 'list')).toEqual([]);
    expect(roles(ServicePackagesController.prototype, 'findOne')).toEqual([]);
    expect(roles(ServicePackagesController.prototype, 'create')).toEqual(['ADMIN']);
    expect(roles(ServicePackagesController.prototype, 'update')).toEqual(['ADMIN']);
  });

  it('allows only approved customer managers to mutate structured contacts', () => {
    expect(roles(CustomersController.prototype, 'createContact')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
    expect(roles(CustomersController.prototype, 'updateContact')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
  });
});
