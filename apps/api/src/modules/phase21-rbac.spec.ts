import { REQUIRED_ROLES_KEY } from '../identity/auth.constants';
import { CurrenciesController } from './currencies/currencies.controller';
import { CustomerChannelsController } from './customers/customer-channels.controller';
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

  it('keeps exchange-rate reads authenticated globally and rate management Admin-only', () => {
    expect(roles(CurrenciesController.prototype, 'list')).toEqual([]);
    expect(roles(CurrenciesController.prototype, 'create')).toEqual(['ADMIN']);
    expect(roles(CurrenciesController.prototype, 'update')).toEqual(['ADMIN']);
  });

  it('allows only approved customer managers to mutate email/phone contact channels', () => {
    expect(roles(CustomerChannelsController.prototype, 'list')).toEqual([]);
    expect(roles(CustomerChannelsController.prototype, 'createEmail')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
    expect(roles(CustomerChannelsController.prototype, 'updateEmail')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
    expect(roles(CustomerChannelsController.prototype, 'createPhone')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
    expect(roles(CustomerChannelsController.prototype, 'updatePhone')).toEqual([
      'ADMIN',
      'SALES_DEVELOPMENT',
    ]);
  });
});
