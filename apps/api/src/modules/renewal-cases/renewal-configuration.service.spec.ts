import { jest } from '@jest/globals';
import { RenewalConfigurationService } from './renewal-configuration.service';

describe('RenewalConfigurationService', () => {
  it('validates and audits reminder template changes', async () => {
    const oldState = {
      id: 'template-id',
      subjectTemplate: '{{subscriptionName}}',
      bodyTemplate: '{{renewalDate}}',
    };
    const updated = { ...oldState, bodyTemplate: '{{customerCompany}} {{renewalDate}}' };
    const tx = { renewalTemplate: { update: jest.fn(() => Promise.resolve(updated)) } };
    const prisma = {
      renewalTemplate: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const renderer = { validate: jest.fn() };
    const service = new RenewalConfigurationService(
      prisma as never,
      audit as never,
      renderer as never,
    );
    expect(
      await service.updateTemplate(
        'template-id',
        { bodyTemplate: updated.bodyTemplate },
        { actorId: 'admin-id' },
      ),
    ).toBe(updated);
    expect(renderer.validate).toHaveBeenCalledWith(updated.bodyTemplate);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.template.updated' }),
      tx,
    );
  });
});
