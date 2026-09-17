import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueueOperatorReplyDto, ThreadListQueryDto } from './communication-threads.dto';

describe('QueueOperatorReplyDto (§8/§20)', () => {
  it('accepts a valid reply with idempotencyKey + bodyText only', async () => {
    const instance = plainToInstance(QueueOperatorReplyDto, { idempotencyKey: 'idem-1', bodyText: 'Thanks!' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects a client-supplied "to"/recipient field — recipient is always resolved server-side', async () => {
    const instance = plainToInstance(QueueOperatorReplyDto, {
      idempotencyKey: 'idem-1',
      bodyText: 'Thanks!',
      to: 'arbitrary@attacker.test',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'to' })]));
  });

  it('rejects confidence/provider/workflow-shaped fields the same way — no such fields exist on this DTO', async () => {
    for (const field of ['confidence', 'resultingAction', 'renewalCaseStatus', 'provider']) {
      const instance = plainToInstance(QueueOperatorReplyDto, { idempotencyKey: 'idem-1', bodyText: 'x', [field]: 'x' });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: field })]));
    }
  });

  it('requires idempotencyKey and bodyText', async () => {
    const instance = plainToInstance(QueueOperatorReplyDto, {});
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    const properties = errors.map((error) => error.property);
    expect(properties).toEqual(expect.arrayContaining(['idempotencyKey', 'bodyText']));
  });
});

describe('ThreadListQueryDto (§4)', () => {
  it('accepts an empty query (defaults apply)', async () => {
    const instance = plainToInstance(ThreadListQueryDto, {});
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
    expect(instance.page).toBe(1);
    expect(instance.pageSize).toBe(20);
  });

  it('accepts the documented filters: status, renewalCaseId, attention, search', async () => {
    const instance = plainToInstance(ThreadListQueryDto, {
      status: 'HUMAN_REVIEW',
      renewalCaseId: '11111111-1111-4111-8111-111111111111',
      attention: 'true',
      search: 'acme',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
    expect(instance.attention).toBe(true);
  });

  it('rejects an invalid ThreadStatus value', async () => {
    const instance = plainToInstance(ThreadListQueryDto, { status: 'NOT_A_STATUS' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'status' })]));
  });
});
