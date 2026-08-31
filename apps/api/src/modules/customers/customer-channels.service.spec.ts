import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerContactRole } from '../../generated/prisma/enums';
import { CustomerChannelsService } from './customer-channels.service';

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
    const service = new CustomerChannelsService(prisma as never, audit as never);

    await expect(service.list('customer-id')).resolves.toEqual({ emailAddresses, phoneNumbers });
  });

  it('throws when listing channels for an unknown customer', async () => {
    const prisma = { customer: { findUnique: jest.fn(() => Promise.resolve(null)) } };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(prisma as never, audit as never);

    await expect(service.list('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('demotes the previous primary email and syncs Customer.primaryEmail when adding a new primary', async () => {
    const emailAddress = { id: 'email-id', email: 'ap@example.test', primary: true };
    const tx = {
      customer: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'customer-id', secondaryEmail: null })),
        update: jest.fn(() => Promise.resolve({})),
      },
      customerEmailAddress: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        create: jest.fn(() => Promise.resolve(emailAddress)),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new CustomerChannelsService(prisma as never, audit as never);

    const result = await service.createEmail(
      'customer-id',
      { email: 'ap@example.test', role: CustomerContactRole.BILLING, primary: true },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(emailAddress);
    expect(tx.customerEmailAddress.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-id', primary: true },
      data: { primary: false },
    });
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-id' },
      data: { primaryEmail: 'ap@example.test' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'customer.email_address_created',
        subjectId: 'email-id',
      }),
      tx,
    );
  });

  it('requires the E.164 phone number to start with the given country calling code', async () => {
    const prisma = { $transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new CustomerChannelsService(prisma as never, audit as never);

    await expect(
      service.createPhone(
        'customer-id',
        {
          phoneNumber: '+15551234567',
          countryCallingCode: '+962',
          role: CustomerContactRole.OTHER,
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
    const service = new CustomerChannelsService(prisma as never, audit as never);

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
    const service = new CustomerChannelsService(prisma as never, audit as never);

    await expect(
      service.updatePhone('customer-id', 'phone-id', { primary: true }, { actorId: 'actor-id' }),
    ).rejects.toThrow(NotFoundException);
  });
});
