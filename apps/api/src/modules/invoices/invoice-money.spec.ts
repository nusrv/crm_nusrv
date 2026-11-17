import { calculateInvoice } from './invoice-money';

describe('invoice money calculation', () => {
  it('calculates quantity, discount, tax, and totals deterministically at three decimals', () => {
    const result = calculateInvoice([
      {
        description: 'Managed hosting',
        quantity: '2',
        unitPrice: '100.125',
        discountAmount: '10.250',
        taxCategoryCode: 'STANDARD',
        taxRate: '16',
      },
    ]);

    expect(result.lines[0]).toEqual(
      expect.objectContaining({
        lineSubtotal: '190.000',
        taxAmount: '30.400',
        lineTotal: '220.400',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        subtotal: '190.000',
        discountTotal: '10.250',
        taxTotal: '30.400',
        grandTotal: '220.400',
      }),
    );
  });

  it('keeps missing tax explicit while allowing a provisional draft calculation', () => {
    const result = calculateInvoice([
      {
        description: 'Domain renewal',
        quantity: '1',
        unitPrice: '25',
        discountAmount: '0',
        taxRate: null,
      },
    ]);

    expect(result.lines[0]?.taxRate).toBeNull();
    expect(result.taxTotal).toBe('0.000');
  });

  it('rejects discounts above gross and rates above 100 percent', () => {
    expect(() =>
      calculateInvoice([
        { description: 'Service', quantity: '1', unitPrice: '5', discountAmount: '6' },
      ]),
    ).toThrow('discount cannot exceed');
    expect(() =>
      calculateInvoice([
        {
          description: 'Service',
          quantity: '1',
          unitPrice: '5',
          discountAmount: '0',
          taxRate: '101',
        },
      ]),
    ).toThrow('tax rate cannot exceed 100%');
  });
});
