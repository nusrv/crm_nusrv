import { jest } from '@jest/globals';
import { renewalRecipients } from './renewal-mail-recipient';

function contact(id: string, role: string, email: string | null) {
  return { id, role, email, name: id.toUpperCase() };
}

function harness(contacts: ReturnType<typeof contact>[], fallback: string | null) {
  const findMany = jest.fn(async (_query: unknown) => contacts);
  const resolvePrimaryRecipient = jest.fn(async (_customerId: string, _tx: unknown) =>
    fallback ? { email: fallback } : null,
  );
  return {
    db: { customerContact: { findMany } },
    emails: { resolvePrimaryRecipient },
    findMany,
  };
}

describe('P1 registered renewal recipients (OD-1)', () => {
  it('prefers active BILLING even when a PRIMARY contact appears first', async () => {
    const h = harness([
      contact('primary-1', 'PRIMARY', 'primary@example.test'),
      contact('billing-1', 'BILLING', 'billing@example.test'),
      contact('other-1', 'TECHNICAL', 'technical@example.test'),
    ], 'main@example.test');
    const result = await renewalRecipients(h.db as never, h.emails as never, 'customer-1');
    expect(result.defaultRecipient).toMatchObject({
      contactId: 'billing-1', role: 'BILLING', email: 'billing@example.test',
    });
    expect(result.options.map((entry) => entry.email)).toEqual([
      'primary@example.test', 'billing@example.test', 'technical@example.test', 'main@example.test',
    ]);
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'customer-1', active: true },
    }));
  });

  it('falls back to PRIMARY and then to the customer main email', async () => {
    const withPrimary = harness([contact('primary-1', 'PRIMARY', 'primary@example.test')], 'main@example.test');
    const primary = await renewalRecipients(withPrimary.db as never, withPrimary.emails as never, 'customer-1');
    expect(primary.defaultRecipient?.email).toBe('primary@example.test');

    const noContacts = harness([], 'main@example.test');
    const fallback = await renewalRecipients(noContacts.db as never, noContacts.emails as never, 'customer-1');
    expect(fallback.defaultRecipient).toMatchObject({
      contactId: null, role: 'CUSTOMER_EMAIL', email: 'main@example.test',
    });
  });

  it('filters invalid and missing contact addresses rather than selecting them', async () => {
    const h = harness([
      contact('bad-1', 'BILLING', 'not-an-email'),
      contact('missing-1', 'PRIMARY', null),
      contact('valid-1', 'TECHNICAL', 'valid@example.test'),
    ], null);
    const result = await renewalRecipients(h.db as never, h.emails as never, 'customer-1');
    expect(result.defaultRecipient).toBeNull();
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.email).toBe('valid@example.test');
  });
});
