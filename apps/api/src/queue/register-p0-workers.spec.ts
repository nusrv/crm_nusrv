import { jest } from '@jest/globals';
import { BullModule, BullRegistrar } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WorkerQueueFoundationModule } from './queue-foundation.module';
import { registerP0Workers } from './register-p0-workers';

describe('P0 worker startup gate', () => {
  it('keeps actual BullMQ automatic registration off in the worker foundation module', async () => {
    const app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ REDIS_HOST: '127.0.0.1', REDIS_PORT: 1 })],
        }),
        WorkerQueueFoundationModule,
        BullModule.registerQueue(),
      ],
    }).compile();
    // No named queues or processors are installed, so this check requires no Redis.
    const registrar = app.get(BullRegistrar);
    const register = jest.spyOn(registrar, 'register');
    try {
      await app.init();
      expect(register).not.toHaveBeenCalled();
      const query = jest.fn(() => Promise.resolve([]));
      await registerP0Workers({ $queryRaw: query } as never, registrar);
      expect(register).toHaveBeenCalledTimes(1);
    } finally {
      register.mockRestore();
      await app.close();
    }
  });

  it('registers only after all four worker table projections can be selected', async () => {
    const statements: string[] = [];
    const register = jest.fn(() => expect(statements).toHaveLength(4));
    const query = jest.fn((parts: TemplateStringsArray) => {
      statements.push(parts.join(''));
      return Promise.resolve([]);
    });

    await registerP0Workers({ $queryRaw: query } as never, { register });

    expect(statements).toEqual([
      expect.stringContaining('smtp_uncertain, next_attempt_at FROM communication_outbox LIMIT 0'),
      expect.stringContaining('smtp_uncertain, next_attempt_at FROM operator_reply_outbox LIMIT 0'),
      expect.stringContaining('FROM email_messages LIMIT 0'),
      expect.stringContaining('FROM renewal_cases LIMIT 0'),
    ]);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('checks all enabled P2 evidence projections before registering consumers', async () => {
    const statements: string[] = [];
    const query = jest.fn((parts: TemplateStringsArray) => {
      statements.push(parts.join(''));
      return Promise.resolve([]);
    });
    const register = jest.fn(() => expect(statements).toHaveLength(8));
    await registerP0Workers({ $queryRaw: query } as never, { register }, { sent: true, review: true });
    expect(statements.slice(4)).toEqual([
      expect.stringContaining('FROM mail_sent_connection_epochs LIMIT 0'),
      expect.stringContaining('FROM mail_evidence_folder_checkpoints LIMIT 0'),
      expect.stringContaining('FROM mail_sent_observations LIMIT 0'),
      expect.stringContaining('FROM mail_dsn_reviews LIMIT 0'),
    ]);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each([5, 6, 7, 8])('blocks consumers when enabled P2 projection %i is missing', async (failure) => {
    let queries = 0;
    const query = jest.fn(() => ++queries === failure ? Promise.reject(new Error('missing evidence table')) : Promise.resolve([]));
    const register = jest.fn();
    await expect(registerP0Workers({ $queryRaw: query } as never, { register }, { sent: true, review: true }))
      .rejects.toThrow('P2 worker schema check failed.');
    expect(register).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4])('does not attach any processors if projection %i fails', async (failure) => {
    let queries = 0;
    const query = jest.fn(() => ++queries === failure
      ? Promise.reject(new Error('database-driver error with private connection details'))
      : Promise.resolve([]));
    const register = jest.fn();

    await expect(registerP0Workers({ $queryRaw: query } as never, { register }))
      .rejects.toThrow('P0 worker schema check failed.');
    expect(register).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(failure);
  });
});
