import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  ActorType,
  CommunicationOutboxStatus,
  CustomerStatus,
  ReminderAudience,
  RenewalCaseStatus,
  RenewalDecisionOutcome,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { ClockService } from '../../time/clock.service';
import { aggregateEffectiveHolds, cycleStartDate, isReminderEligible } from './renewal-policy';
import { RenewalTemplateRenderer, type RenewalTemplateValues } from './renewal-template.renderer';

const subscriptionInclude = {
  customer: { include: { billingEntity: true } },
  serviceType: true,
} as const;

type EvaluatedSubscription = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;

export interface RenewalEvaluationOptions {
  asOf?: Date;
  trigger?: 'scheduled' | 'manual' | 'test';
  actorId?: string;
  ipAddress?: string;
}

export interface RenewalEvaluationSummary {
  subscriptionsEvaluated: number;
  casesCreated: number;
  customerRemindersQueued: number;
  internalNotificationsQueued: number;
  duplicatesPrevented: number;
  heldDecisions: number;
  ineligibleDecisions: number;
  internalRulesWithoutRecipients: number;
  asOf: string;
  businessDate: string;
}

@Injectable()
export class RenewalEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly businessTime: BusinessTimeService,
    private readonly clock: ClockService,
    private readonly renderer: RenewalTemplateRenderer,
  ) {}

  async evaluateAll(options: RenewalEvaluationOptions = {}): Promise<RenewalEvaluationSummary> {
    const asOf = options.asOf ?? this.clock.now();
    const [reminderRules, notificationRules] = await Promise.all([
      this.prisma.reminderRule.findMany({
        where: { enabled: true, template: { enabled: true } },
        include: { template: true },
      }),
      this.prisma.notificationRule.findMany({ where: { enabled: true } }),
    ]);
    const configuredDays = [
      ...reminderRules.map((rule) => rule.daysBeforeDue),
      ...notificationRules.map((rule) => rule.daysBeforeDue),
    ].filter((days) => days >= 0);
    const maxDays = configuredDays.length ? Math.max(...configuredDays) : 30;
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        customer: { status: CustomerStatus.ACTIVE },
        renewalDate: {
          gte: this.businessTime.businessDate(asOf),
          lte: this.businessTime.addBusinessDays(asOf, maxDays),
        },
      },
      include: subscriptionInclude,
      orderBy: [{ renewalDate: 'asc' }, { id: 'asc' }],
    });
    const summary: RenewalEvaluationSummary = {
      subscriptionsEvaluated: subscriptions.length,
      casesCreated: 0,
      customerRemindersQueued: 0,
      internalNotificationsQueued: 0,
      duplicatesPrevented: 0,
      heldDecisions: 0,
      ineligibleDecisions: 0,
      internalRulesWithoutRecipients: 0,
      asOf: asOf.toISOString(),
      businessDate: this.businessTime.businessDateKey(asOf),
    };

    for (const subscription of subscriptions) {
      const ensured = await this.ensureCase(subscription, options, asOf);
      if (ensured.created) summary.casesCreated += 1;
      const renewalCase = await this.prisma.renewalCase.findUniqueOrThrow({
        where: { id: ensured.id },
        include: { holds: { where: { active: true }, orderBy: { createdAt: 'desc' } } },
      });
      const daysBeforeDue = this.businessTime.daysUntil(subscription.renewalDate, asOf);
      const customerRule = reminderRules.find((rule) => rule.daysBeforeDue === daysBeforeDue);
      const internalRules = notificationRules.filter(
        (rule) => rule.daysBeforeDue === daysBeforeDue,
      );
      if (!customerRule && !internalRules.length) {
        await this.prisma.renewalCase.updateMany({
          where: { id: renewalCase.id },
          data: { lastEvaluatedAt: asOf },
        });
        continue;
      }
      if (!isReminderEligible(renewalCase.status)) {
        if (
          await this.recordDecision(
            renewalCase.id,
            `ineligible:${daysBeforeDue}:${renewalCase.status}`,
            RenewalDecisionOutcome.SKIPPED_INELIGIBLE,
            daysBeforeDue,
            `Workflow status ${renewalCase.status} does not permit renewal reminders.`,
            options,
          )
        ) {
          summary.ineligibleDecisions += 1;
        }
        continue;
      }

      const holdPolicy = aggregateEffectiveHolds(renewalCase.holds, asOf);
      const values = this.templateValues(subscription, renewalCase.id);
      if (customerRule) {
        if (holdPolicy.stopCustomerReminders) {
          if (
            await this.recordDecision(
              renewalCase.id,
              `hold:customer:${holdPolicy.customerReminderHoldIds.join(',')}:${customerRule.id}`,
              RenewalDecisionOutcome.SKIPPED_HOLD,
              daysBeforeDue,
              'Customer reminder suppressed by an active workflow hold.',
              options,
              { effectiveHoldIds: holdPolicy.customerReminderHoldIds },
            )
          ) {
            summary.heldDecisions += 1;
          }
        } else {
          const queued = await this.queueOutbox({
            subscription,
            renewalCaseId: renewalCase.id,
            audience: ReminderAudience.CUSTOMER,
            recipient: subscription.customer.primaryEmail,
            subject: this.renderer.render(customerRule.template.subjectTemplate, values),
            body: this.renderer.render(customerRule.template.bodyTemplate, values),
            daysBeforeDue,
            reminderRuleId: customerRule.id,
            idempotencyParts: ['customer', renewalCase.id, customerRule.id, String(daysBeforeDue)],
            asOf,
            options,
          });
          if (queued) summary.customerRemindersQueued += 1;
          else summary.duplicatesPrevented += 1;
        }
      }

      for (const rule of internalRules) {
        if (holdPolicy.stopInternalNotifications && rule.suppressOnWorkflowHold) {
          if (
            await this.recordDecision(
              renewalCase.id,
              `hold:internal:${holdPolicy.internalNotificationHoldIds.join(',')}:${rule.id}`,
              RenewalDecisionOutcome.SKIPPED_HOLD,
              daysBeforeDue,
              'Internal escalation suppressed by an active workflow hold.',
              options,
              { effectiveHoldIds: holdPolicy.internalNotificationHoldIds },
            )
          ) {
            summary.heldDecisions += 1;
          }
          continue;
        }
        const recipients = await this.internalRecipients(rule.recipientRoles, rule.recipientEmails);
        if (!recipients.length) {
          summary.internalRulesWithoutRecipients += 1;
          continue;
        }
        for (const recipient of recipients) {
          const queued = await this.queueOutbox({
            subscription,
            renewalCaseId: renewalCase.id,
            audience: ReminderAudience.INTERNAL,
            recipient,
            subject: this.renderer.render(rule.subjectTemplate, values),
            body: this.renderer.render(rule.bodyTemplate, values),
            daysBeforeDue,
            notificationRuleId: rule.id,
            idempotencyParts: [
              'internal',
              renewalCase.id,
              rule.id,
              recipient.toLowerCase(),
              String(daysBeforeDue),
            ],
            asOf,
            options,
          });
          if (queued) summary.internalNotificationsQueued += 1;
          else summary.duplicatesPrevented += 1;
        }
      }
      await this.prisma.renewalCase.updateMany({
        where: { id: renewalCase.id },
        data: { lastEvaluatedAt: asOf },
      });
    }

    await this.audit.record({
      actorType: options.actorId ? ActorType.USER : ActorType.SYSTEM,
      actorId: options.actorId,
      eventKey:
        options.trigger === 'manual'
          ? 'renewal.engine.manual_execution.completed'
          : 'renewal.engine.scheduled_execution.completed',
      subjectType: 'RenewalEngine',
      subjectId: summary.businessDate,
      metadata: summary,
      ipAddress: options.ipAddress,
    });
    return summary;
  }

  private async ensureCase(
    subscription: EvaluatedSubscription,
    options: RenewalEvaluationOptions,
    asOf: Date,
  ): Promise<{ id: string; created: boolean }> {
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const renewalCase = await tx.renewalCase.create({
          data: {
            subscriptionId: subscription.id,
            cycleStartDate: cycleStartDate(
              subscription.startDate,
              subscription.renewalDate,
              subscription.billingFrequency,
              subscription.renewalIntervalMonths,
            ),
            dueDate: subscription.renewalDate,
            lastEvaluatedAt: asOf,
          },
        });
        await this.audit.record(
          {
            actorType: options.actorId ? ActorType.USER : ActorType.SYSTEM,
            actorId: options.actorId,
            eventKey: 'renewal.case.created',
            subjectType: 'RenewalCase',
            subjectId: renewalCase.id,
            newState: renewalCase,
            metadata: { subscriptionId: subscription.id, trigger: options.trigger ?? 'scheduled' },
            ipAddress: options.ipAddress,
          },
          tx,
        );
        return renewalCase;
      });
      return { id: record.id, created: true };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.prisma.renewalCase.findUniqueOrThrow({
        where: {
          subscriptionId_dueDate: {
            subscriptionId: subscription.id,
            dueDate: subscription.renewalDate,
          },
        },
        select: { id: true },
      });
      return { id: existing.id, created: false };
    }
  }

  private async queueOutbox(input: {
    subscription: EvaluatedSubscription;
    renewalCaseId: string;
    audience: ReminderAudience;
    recipient: string;
    subject: string;
    body: string;
    daysBeforeDue: number;
    reminderRuleId?: string;
    notificationRuleId?: string;
    idempotencyParts: string[];
    asOf: Date;
    options: RenewalEvaluationOptions;
  }): Promise<boolean> {
    const idempotencyKey = this.idempotencyKey(input.idempotencyParts);
    const outboxId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.record(
          {
            actorType: input.options.actorId ? ActorType.USER : ActorType.SYSTEM,
            actorId: input.options.actorId,
            eventKey: 'renewal.reminder.evaluated',
            subjectType: 'RenewalCase',
            subjectId: input.renewalCaseId,
            metadata: {
              audience: input.audience,
              daysBeforeDue: input.daysBeforeDue,
              idempotencyKey,
            },
            ipAddress: input.options.ipAddress,
          },
          tx,
        );
        const queuedAudit = await this.audit.record(
          {
            actorType: input.options.actorId ? ActorType.USER : ActorType.SYSTEM,
            actorId: input.options.actorId,
            eventKey:
              input.audience === ReminderAudience.CUSTOMER
                ? 'renewal.reminder.queued'
                : 'renewal.internal_escalation.queued',
            subjectType: 'CommunicationOutbox',
            subjectId: outboxId,
            metadata: {
              renewalCaseId: input.renewalCaseId,
              subscriptionId: input.subscription.id,
              recipient: input.recipient,
              daysBeforeDue: input.daysBeforeDue,
              idempotencyKey,
            },
            ipAddress: input.options.ipAddress,
          },
          tx,
        );
        await tx.communicationOutbox.create({
          data: {
            id: outboxId,
            customerId: input.subscription.customerId,
            subscriptionId: input.subscription.id,
            renewalCaseId: input.renewalCaseId,
            reminderRuleId: input.reminderRuleId,
            notificationRuleId: input.notificationRuleId,
            auditEventId: queuedAudit.id,
            audience: input.audience,
            recipient: input.recipient.trim().toLowerCase(),
            subject: input.subject,
            body: input.body,
            daysBeforeDue: input.daysBeforeDue,
            status: CommunicationOutboxStatus.QUEUED,
            scheduledAt: input.asOf,
            idempotencyKey,
          },
        });
        if (input.audience === ReminderAudience.CUSTOMER) {
          await tx.renewalCase.updateMany({
            where: { id: input.renewalCaseId, status: RenewalCaseStatus.UPCOMING },
            data: { status: RenewalCaseStatus.REMINDER_CYCLE },
          });
        }
      });
      return true;
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      await this.recordDecision(
        input.renewalCaseId,
        `duplicate:${idempotencyKey}`,
        RenewalDecisionOutcome.DUPLICATE_PREVENTED,
        input.daysBeforeDue,
        'A communication with the same idempotency key already exists.',
        input.options,
      );
      return false;
    }
  }

  private async recordDecision(
    renewalCaseId: string,
    decisionSeed: string,
    outcome: RenewalDecisionOutcome,
    daysBeforeDue: number,
    reason: string,
    options: RenewalEvaluationOptions,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const decisionKey = this.idempotencyKey([renewalCaseId, decisionSeed]);
    try {
      await this.prisma.$transaction(async (tx) => {
        const decision = await tx.renewalEvaluationDecision.create({
          data: { renewalCaseId, decisionKey, outcome, daysBeforeDue, reason },
        });
        await this.audit.record(
          {
            actorType: options.actorId ? ActorType.USER : ActorType.SYSTEM,
            actorId: options.actorId,
            eventKey:
              outcome === RenewalDecisionOutcome.SKIPPED_HOLD
                ? 'renewal.reminder.skipped.hold'
                : outcome === RenewalDecisionOutcome.SKIPPED_INELIGIBLE
                  ? 'renewal.reminder.skipped.ineligible'
                  : 'renewal.reminder.duplicate_prevented',
            subjectType: 'RenewalEvaluationDecision',
            subjectId: decision.id,
            metadata: { renewalCaseId, daysBeforeDue, reason, decisionKey, ...metadata },
            ipAddress: options.ipAddress,
          },
          tx,
        );
      });
      return true;
    } catch (error) {
      if (this.isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private templateValues(
    subscription: EvaluatedSubscription,
    renewalCaseId: string,
  ): RenewalTemplateValues {
    return {
      customerCompany: subscription.customer.companyName,
      customerContact: subscription.customer.contactName ?? subscription.customer.companyName,
      subscriptionName: subscription.name,
      serviceType: subscription.serviceType.name,
      renewalDate: this.businessTime.databaseDateKey(subscription.renewalDate),
      serviceDescription: subscription.description ?? subscription.name,
      renewalAmount: subscription.sellingPrice.toFixed(3),
      currency: subscription.currency,
      billingEntity: subscription.customer.billingEntity.name,
      renewalCaseReference: renewalCaseId,
    };
  }

  private async internalRecipients(roleValue: unknown, emailValue: unknown): Promise<string[]> {
    const roles = this.stringArray(roleValue);
    const configuredEmails = this.stringArray(emailValue);
    const users = roles.length
      ? await this.prisma.user.findMany({
          where: {
            active: true,
            roles: { some: { role: { code: { in: roles } } } },
          },
          select: { email: true },
        })
      : [];
    return [
      ...new Set(
        [...configuredEmails, ...users.map((user) => user.email)]
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private idempotencyKey(parts: string[]): string {
    return `renewal:${createHash('sha256').update(parts.join('|')).digest('hex')}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
