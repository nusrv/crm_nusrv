import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import type {
  CreateCustomerEmailAddressDto,
  CreateCustomerPhoneNumberDto,
  UpdateCustomerEmailAddressDto,
  UpdateCustomerPhoneNumberDto,
} from './customers.dto';

@Injectable()
export class CustomerChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(customerId: string) {
    await this.requireCustomer(customerId);
    const [emailAddresses, phoneNumbers] = await Promise.all([
      this.prisma.customerEmailAddress.findMany({
        where: { customerId },
        orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.customerPhoneNumber.findMany({
        where: { customerId },
        orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { emailAddresses, phoneNumbers };
  }

  async createEmail(
    customerId: string,
    input: CreateCustomerEmailAddressDto,
    context: MutationContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Customer not found.');
      if (input.primary) {
        await tx.customerEmailAddress.updateMany({
          where: { customerId, primary: true },
          data: { primary: false },
        });
      }
      const emailAddress = await tx.customerEmailAddress.create({
        data: { ...input, customerId },
      });
      if (input.primary) {
        await tx.customer.update({
          where: { id: customerId },
          data: { primaryEmail: input.email },
        });
      } else if (!customer.secondaryEmail) {
        await tx.customer.update({
          where: { id: customerId },
          data: { secondaryEmail: input.email },
        });
      }
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.email_address_created',
          subjectType: 'CustomerEmailAddress',
          subjectId: emailAddress.id,
          newState: emailAddress,
          metadata: { customerId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return emailAddress;
    });
  }

  async updateEmail(
    customerId: string,
    emailId: string,
    input: UpdateCustomerEmailAddressDto,
    context: MutationContext,
  ) {
    const oldState = await this.prisma.customerEmailAddress.findFirst({
      where: { id: emailId, customerId },
    });
    if (!oldState) throw new NotFoundException('Customer email address not found.');
    return this.prisma.$transaction(async (tx) => {
      if (input.primary) {
        await tx.customerEmailAddress.updateMany({
          where: { customerId, primary: true, id: { not: emailId } },
          data: { primary: false },
        });
      }
      const emailAddress = await tx.customerEmailAddress.update({
        where: { id: emailId },
        data: input,
      });
      if (emailAddress.primary && emailAddress.active) {
        await tx.customer.update({
          where: { id: customerId },
          data: { primaryEmail: emailAddress.email },
        });
      }
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.email_address_updated',
          subjectType: 'CustomerEmailAddress',
          subjectId: emailAddress.id,
          oldState,
          newState: emailAddress,
          metadata: { customerId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return emailAddress;
    });
  }

  async createPhone(
    customerId: string,
    input: CreateCustomerPhoneNumberDto,
    context: MutationContext,
  ) {
    this.validatePhone(input.phoneNumber, input.countryCallingCode);
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Customer not found.');
      if (input.primary) {
        await tx.customerPhoneNumber.updateMany({
          where: { customerId, primary: true },
          data: { primary: false },
        });
      }
      const phoneNumber = await tx.customerPhoneNumber.create({
        data: { ...input, customerId },
      });
      if (input.primary || !customer.phone) {
        await tx.customer.update({ where: { id: customerId }, data: { phone: input.phoneNumber } });
      }
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.phone_number_created',
          subjectType: 'CustomerPhoneNumber',
          subjectId: phoneNumber.id,
          newState: phoneNumber,
          metadata: { customerId, format: 'E.164' },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return phoneNumber;
    });
  }

  async updatePhone(
    customerId: string,
    phoneId: string,
    input: UpdateCustomerPhoneNumberDto,
    context: MutationContext,
  ) {
    const oldState = await this.prisma.customerPhoneNumber.findFirst({
      where: { id: phoneId, customerId },
    });
    if (!oldState) throw new NotFoundException('Customer phone number not found.');
    this.validatePhone(
      input.phoneNumber ?? oldState.phoneNumber,
      input.countryCallingCode ?? oldState.countryCallingCode,
    );
    return this.prisma.$transaction(async (tx) => {
      if (input.primary) {
        await tx.customerPhoneNumber.updateMany({
          where: { customerId, primary: true, id: { not: phoneId } },
          data: { primary: false },
        });
      }
      const phoneNumber = await tx.customerPhoneNumber.update({
        where: { id: phoneId },
        data: input,
      });
      if (phoneNumber.primary && phoneNumber.active) {
        await tx.customer.update({
          where: { id: customerId },
          data: { phone: phoneNumber.phoneNumber },
        });
      }
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'customer.phone_number_updated',
          subjectType: 'CustomerPhoneNumber',
          subjectId: phoneNumber.id,
          oldState,
          newState: phoneNumber,
          metadata: { customerId, format: 'E.164' },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return phoneNumber;
    });
  }

  private async requireCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
  }

  private validatePhone(phone: string, countryCallingCode: string): void {
    if (!phone.startsWith(countryCallingCode)) {
      throw new BadRequestException(
        'The E.164 phone number must start with the selected country calling code.',
      );
    }
  }
}
