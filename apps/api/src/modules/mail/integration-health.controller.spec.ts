import 'reflect-metadata';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { IntegrationHealthController } from './integration-health.controller';

describe('P2.A mail evidence inventory authorization', () => {
  it('restricts evidence-source inventory to authenticated ADMIN or IT roles', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      IntegrationHealthController.prototype,
      'getEvidenceSources',
    )?.value;
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_ROLES_KEY, handler as object)).toEqual([
      'ADMIN', 'IT',
    ]);
  });

  it('delegates only to the read-only health inventory method', async () => {
    const expected = [{
      mailConfigurationId: 'mail-1',
      inboundFolder: 'CONFIGURED_ONLY',
      sentFolder: 'NOT_IMPLEMENTED',
      providerEvents: 'NOT_IMPLEMENTED',
      dsnCorrelation: 'NOT_IMPLEMENTED',
    }];
    const getEvidenceSources = jest.fn(() => Promise.resolve(expected));
    const controller = new IntegrationHealthController({
      getEvidenceSources,
    } as never);
    await expect(controller.getEvidenceSources()).resolves.toBe(expected);
    expect(getEvidenceSources).toHaveBeenCalledTimes(1);
  });
});
