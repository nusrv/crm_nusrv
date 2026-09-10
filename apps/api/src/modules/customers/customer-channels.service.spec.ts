import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerContactRole, PhoneType } from '../../generated/prisma/enums';
import { CustomerChannelsService } from './customer-channels.service';

function noopEmailResolution() {
  return { resolvePrimaryRecipient: jest.fn() };
}

describe('CustomerChannelsService', () => {
  it('lists a customer email addresses and phone numbers, primary first', async () => {
    const emailAddresses = [{ id: 'email-id', primary: true }];
    const phoneNumbers = [{ id: 'phone-id', primary: true }];
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ id: 'customer-id' })) },
      customerEmailAddress: { findMany: jest.fn(() => Promise.resolve(emailAddresses)) },
      customerPhoneNumber: { findMany: jest.fn(() => Promise.resolve(phoneNumbers)) },
    };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(
      prisma as never,
      audit as never,
      noopEmailResolution() as never,
    );

    await expect(service.list('customer-id')).resolves.toEqual({ emailAddresses, phoneNumbers });
  });

  it('throws when listing channels for an unknown customer', async () => {
    const prisma = { customer: { findUnique: jest.fn(() => Promise.resolve(null)) } };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(
      prisma as never,
      audit as never,
      noopEmailResolution() as never,
    );

    await expect(service.list('missing-id')).rejects.toThrow(NotFoundException);
  });

  describe('email primary-scalar synchronization', () => {
    function harness() {
      const tx = {
        customer: {
          findUnique: jest.fn(() => Promise.resolve({ id: 'customer-id', secondaryEmail: null })),
          update: jest.fn(() => Promise.resolve({})),
        },
        customerEmailAddress: {
          updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
          create: jest.fn(() =>
            Promise.resolve({ id: 'email-id', email: 'ap@example.test', primary: true }),
          ),
          update: jest.fn(() =>
            Promise.resolve({ id: 'email-id', email: 'ap@example.test', primary: true }),
          ),
        },
      };
      const prisma = {
        customerEmailAddress: {
          findFirst: jest.fn(() =>
            Promise.resolve({ id: 'email-id', email: 'ap@example.test', primary: true }),
          ),
        },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
      const emailResolution = {
        resolvePrimaryRecipient: jest.fn<
          () => Promise<{ email: string; source: string } | null>
        >(),
      };
      const service = new CustomerChannelsService(
        prisma as never,
        audit as never,
        emailResolution as never,
      );
      return { service, tx, audit, emailResolution };
    }

    it('syncs Customer.primaryEmail when the resolver finds a normalized active primary', async () => {
      const { service, tx, emailResolution, audit } = harness();
      emailResolution.resolvePrimaryRecipient.mockResolvedValue({
        email: 'ap@example.test',
        source: 'NORMALIZED_PRIMARY',
      });

      const result = await service.createEmail(
        'customer-id',
        { email: 'ap@example.test', role: CustomerContactRole.BILLING, primary: true },
        { actorId: 'actor-id' },
      );

      expect(result).toEqual({ id: 'email-id', email: 'ap@example.test', primary: true });
      expect(tx.customerEmailAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'customer-id', primary: true },
        data: { primary: false },
      });
      expect(emailResolution.resolvePrimaryRecipient).toHaveBeenCalledWith('customer-id', tx);
      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-id' },
        data: { primaryEmail: 'ap@example.test' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: 'customer.email_address_created', subjectId: 'email-id' }),
        tx,
      );
    });

    it('leaves Customer.primaryEmail untouched — never inventing a replacement — when deactivating the current primary leaves no valid recipient', async () => {
      const { service, tx, emailResolution } = harness();
      // The resolver has already checked: normalized channel data exists for this customer, but
      // nothing is currently active+primary (this deactivation removed the only one).
      emailResolution.resolvePrimaryRecipient.mockResolvedValue(null);

      await service.updateEmail(
        'customer-id',
        'email-id',
        { active: false },
        { actorId: 'actor-id' },
      );

      expect(tx.customer.update).not.toHaveBeenCalled();
    });

    it('leaves Customer.primaryEmail untouched when demoting the current primary with no replacement designated', async () => {
      const { service, tx, emailResolution } = harness();
      emailResolution.resolvePrimaryRecipient.mockResolvedValue(null);

      await service.updateEmail(
        'customer-id',
        'email-id',
        { primary: false },
        { actorId: 'actor-id' },
      );

      expect(tx.customer.update).not.toHaveBeenCalled();
    });

    it('re-syncs Customer.primaryEmail to a different channel when updateEmail changes which one is primary+active', async () => {
      const { service, tx, emailResolution } = harness();
      emailResolution.resolvePrimaryRecipient.mockResolvedValue({
        email: 'ap@example.test',
        source: 'NORMALIZED_PRIMARY',
      });

      await service.updateEmail(
        'customer-id',
        'email-id',
        { primary: true, active: true },
        { actorId: 'actor-id' },
      );

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-id' },
        data: { primaryEmail: 'ap@example.test' },
      });
    });
  });

  it('requires the E.164 phone number to start with the given country calling code', async () => {
    const prisma = { $transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(
      prisma as never,
      audit as never,
      noopEmailResolution() as never,
    );

    await expect(
      service.createPhone(
        'customer-id',
        {
          phoneNumber: '+15551234567',
          countryCallingCode: '+962',
          role: CustomerContactRole.OTHER,
          phoneType: PhoneType.PHONE,
          primary: false,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reassigns primary to only the updated phone number and syncs Customer.phone', async () => {
    const oldState = {
      id: 'phone-id',
      phoneNumber: '+962790000000',
      countryCallingCode: '+962',
      primary: false,
    };
    const phoneNumber = { ...oldState, primary: true, active: true };
    const tx = {
      customerPhoneNumber: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(() => Promise.resolve(phoneNumber)),
      },
      customer: { update: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      customerPhoneNumber: { findFirst: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new CustomerChannelsService(
      prisma as never,
      audit as never,
      noopEmailResolution() as never,
    );

    const result = await service.updatePhone(
      'customer-id',
      'phone-id',
      { primary: true },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(phoneNumber);
    expect(tx.customerPhoneNumber.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-id', primary: true, id: { not: 'phone-id' } },
      data: { primary: false },
    });
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-id' },
      data: { phone: '+962790000000' },
    });
  });

  it('throws when updating a phone number that does not belong to the customer', async () => {
    const prisma = { customerPhoneNumber: { findFirst: jest.fn(() => Promise.resolve(null)) } };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(
      prisma as never,
      audit as never,
      noopEmailResolution() as never,
    );

    await expect(
      service.updatePhone('customer-id', 'phone-id', { primary: true }, { actorId: 'actor-id' }),
    ).rejects.toThrow(NotFoundException);
  });
});
