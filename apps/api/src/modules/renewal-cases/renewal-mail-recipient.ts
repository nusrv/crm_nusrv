import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';

export interface RenewalRecipient {
  contactId: string | null;
  email: string;
  name: string | null;
  role: string;
}

export async function renewalRecipients(
  db: Pick<Prisma.TransactionClient, 'customerContact'> & Prisma.TransactionClient,
  emails: CustomerEmailResolutionService,
  customerId: string,
) {
  const contacts = await db.customerContact.findMany({
    where: { customerId, active: true },
    orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, email: true, name: true, role: true },
  });
  const options: RenewalRecipient[] = contacts.flatMap((contact) =>
    contact.email && z.email().safeParse(contact.email).success
      ? [{ contactId: contact.id, email: contact.email, name: contact.name, role: contact.role }]
      : [],
  );
  const billing = options.find(({ role }) => role === 'BILLING');
  const primary = options.find(({ role }) => role === 'PRIMARY');
  const fallback = await emails.resolvePrimaryRecipient(customerId, db);
  const customerEmail = fallback && z.email().safeParse(fallback.email).success
    ? { contactId: null, email: fallback.email, name: null, role: 'CUSTOMER_EMAIL' }
    : null;
  return { options: customerEmail ? [...options, customerEmail] : options, defaultRecipient: billing ?? primary ?? customerEmail };
}
