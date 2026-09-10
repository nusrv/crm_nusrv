import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerDto } from './customers.dto';

describe('UpdateCustomerDto', () => {
  it('rejects a status field under the same whitelist/forbidNonWhitelisted rules the global ValidationPipe enforces', async () => {
    // Mirrors main.ts's ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) exactly —
    // status has no validation decorators on this DTO (see customers.dto.ts), so it must be
    // reported as a forbidden, non-whitelisted property rather than silently accepted or dropped.
    const instance = plainToInstance(UpdateCustomerDto, {
      nameEn: 'Renamed Co',
      status: 'INACTIVE',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'status' })]),
    );
  });

  it('accepts an ordinary edit with no status field at all', async () => {
    const instance = plainToInstance(UpdateCustomerDto, { nameEn: 'Renamed Co' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects a primaryEmail field the same way — the generic PATCH path cannot diverge Customer.primaryEmail from the normalized channel', async () => {
    const instance = plainToInstance(UpdateCustomerDto, {
      nameEn: 'Renamed Co',
      primaryEmail: 'new@example.test',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'primaryEmail' })]),
    );
  });
});
