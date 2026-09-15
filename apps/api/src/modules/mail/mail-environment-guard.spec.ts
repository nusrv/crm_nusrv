import { isMailConfigEnvironmentAllowed } from './mail-environment-guard';

describe('isMailConfigEnvironmentAllowed', () => {
  it('allows only a PRODUCTION-scoped configuration when NODE_ENV=production', () => {
    expect(isMailConfigEnvironmentAllowed('PRODUCTION', 'production')).toBe(true);
    expect(isMailConfigEnvironmentAllowed('SANDBOX', 'production')).toBe(false);
  });

  it.each(['development', 'test', 'staging'])(
    'allows only a SANDBOX-scoped configuration when NODE_ENV=%s',
    (nodeEnv) => {
      expect(isMailConfigEnvironmentAllowed('SANDBOX', nodeEnv)).toBe(true);
      expect(isMailConfigEnvironmentAllowed('PRODUCTION', nodeEnv)).toBe(false);
    },
  );
});
