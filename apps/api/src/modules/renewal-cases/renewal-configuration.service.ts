import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import type {
  UpdateNotificationRuleDto,
  UpdateReminderRuleDto,
  UpdateRenewalTemplateDto,
} from './renewal-cases.dto';
import { RenewalTemplateRenderer } from './renewal-template.renderer';

@Injectable()
export class RenewalConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly renderer: RenewalTemplateRenderer,
  ) {}

  async getConfiguration() {
    const [templates, reminderRules, notificationRules] = await Promise.all([
      this.prisma.renewalTemplate.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.reminderRule.findMany({
        include: { template: true },
        orderBy: { daysBeforeDue: 'desc' },
      }),
      this.prisma.notificationRule.findMany({ orderBy: { daysBeforeDue: 'desc' } }),
    ]);
    return { templates, reminderRules, notificationRules };
  }

  async updateReminderRule(id: string, input: UpdateReminderRuleDto, context: MutationContext) {
    const oldState = await this.prisma.reminderRule.findUnique({ where: { id } });
    if (!oldState) throw new NotFoundException('Reminder Rule not found.');
    if (input.templateId) {
      const template = await this.prisma.renewalTemplate.findUnique({
        where: { id: input.templateId },
        select: { id: true },
      });
      if (!template) throw new BadRequestException('Renewal template does not exist.');
    }
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.reminderRule.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.reminder_rule.updated',
          subjectType: 'ReminderRule',
          subjectId: id,
          oldState,
          newState: rule,
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return rule;
    });
  }

  async updateTemplate(id: string, input: UpdateRenewalTemplateDto, context: MutationContext) {
    const oldState = await this.prisma.renewalTemplate.findUnique({ where: { id } });
    if (!oldState) throw new NotFoundException('Renewal template not found.');
    this.renderer.validate(input.subjectTemplate ?? oldState.subjectTemplate);
    this.renderer.validate(input.bodyTemplate ?? oldState.bodyTemplate);
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.renewalTemplate.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.template.updated',
          subjectType: 'RenewalTemplate',
          subjectId: id,
          oldState,
          newState: template,
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return template;
    });
  }

  async updateNotificationRule(
    id: string,
    input: UpdateNotificationRuleDto,
    context: MutationContext,
  ) {
    const oldState = await this.prisma.notificationRule.findUnique({ where: { id } });
    if (!oldState) throw new NotFoundException('Notification Rule not found.');
    this.renderer.validate(input.subjectTemplate ?? oldState.subjectTemplate);
    this.renderer.validate(input.bodyTemplate ?? oldState.bodyTemplate);
    const data = {
      ...input,
      recipientRoles: input.recipientRoles ? asJson(input.recipientRoles) : undefined,
      recipientEmails: input.recipientEmails
        ? asJson(input.recipientEmails.map((email) => email.trim().toLowerCase()))
        : undefined,
    };
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.notificationRule.update({ where: { id }, data });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.notification_rule.updated',
          subjectType: 'NotificationRule',
          subjectId: id,
          oldState,
          newState: rule,
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return rule;
    });
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
