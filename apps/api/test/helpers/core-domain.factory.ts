export function billingEntityFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'TEST_LOCAL',
    name: 'Test Local Billing Entity',
    legalName: 'Test Local Billing Entity',
    paymentScope: 'LOCAL' as const,
    active: true,
    ...overrides,
  };
}

export function customerFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    billingEntityId: '10000000-0000-4000-8000-000000000001',
    customerCode: 'CUS-TEST-001',
    companyName: 'Example Customer',
    primaryEmail: 'billing@example.test',
    ...overrides,
  };
}

export function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    serviceTypeId: '40000000-0000-4000-8000-000000000001',
    subscriptionCode: 'SUB-TEST-001',
    name: 'Example Hosting',
    startDate: new Date('2026-01-01'),
    renewalDate: new Date('2027-01-01'),
    billingFrequency: 'ANNUAL' as const,
    sellingPrice: '100.000',
    currency: 'JOD',
    ...overrides,
  };
}
