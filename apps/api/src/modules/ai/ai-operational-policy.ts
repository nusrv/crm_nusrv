export const AI_DEFERRED_MESSAGE = 'AI execution is deferred in the current implementation scope.';

// Owner-frozen source policy. Stored settings and environment variables have no override.
export const aiOperationalPolicy = {
  isDeferred(): boolean {
    return true;
  },
};
