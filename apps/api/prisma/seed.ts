import 'dotenv/config';

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { hash } from 'argon2';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import { packageCatalogSeeds } from './package-catalog.seed-data';
import {
  billingEntitySeeds,
  notificationRuleSeeds,
  reminderRuleSeeds,
  renewalTemplateSeeds,
  roleSeeds,
  serviceTypeSeeds,
} from './seed-data';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(toMariaDbDriverUrl(databaseUrl)),
});

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const entity of billingEntitySeeds) {
      await tx.billingEntity.upsert({
        where: { code: entity.code },
        update: { ...entity, active: true },
        create: entity,
      });
    }

    for (const serviceType of serviceTypeSeeds) {
      await tx.serviceType.upsert({
        where: { code: serviceType.code },
        update: { name: serviceType.name, active: true },
        create: serviceType,
      });
    }

    const serviceTypes = await tx.serviceType.findMany({ select: { id: true, code: true } });
    const serviceTypeIds = new Map(serviceTypes.map((type) => [type.code, type.id]));
    for (const packageSeed of packageCatalogSeeds) {
      const serviceTypeId = serviceTypeIds.get(packageSeed.serviceTypeCode);
      if (!serviceTypeId) throw new Error(`Missing service type ${packageSeed.serviceTypeCode}.`);
      const { terms } = packageSeed;
      const catalogData = {
        code: packageSeed.code,
        name: packageSeed.name,
        kind: packageSeed.kind,
        description: packageSeed.description,
        specifications: packageSeed.specifications,
        sourceReference: 'Packages.docx',
      };
      const servicePackage = await tx.servicePackage.upsert({
        where: { code: packageSeed.code },
        update: { ...catalogData, serviceTypeId, active: true },
        create: { ...catalogData, serviceTypeId },
      });
      for (const term of terms) {
        await tx.servicePackageTerm.upsert({
          where: {
            servicePackageId_termMonths_currency: {
              servicePackageId: servicePackage.id,
              termMonths: term.termMonths,
              currency: term.currency,
            },
          },
          update: { standardSellingPrice: term.standardSellingPrice, active: true },
          create: { ...term, servicePackageId: servicePackage.id },
        });
      }
    }

    const templateIds = new Map<string, string>();
    for (const template of renewalTemplateSeeds) {
      const templateData = {
        code: template.code,
        name: template.name,
        subjectTemplate: template.subjectTemplate,
        bodyTemplate: template.bodyTemplate,
      };
      const record = await tx.renewalTemplate.upsert({
        where: { code: template.code },
        update: {},
        create: templateData,
      });
      templateIds.set(template.code, record.id);
    }

    for (const rule of reminderRuleSeeds) {
      const templateId = templateIds.get(rule.templateCode);
      if (!templateId) throw new Error(`Missing renewal template ${rule.templateCode}.`);
      await tx.reminderRule.upsert({
        where: { code: rule.code },
        update: {},
        create: { code: rule.code, name: rule.name, daysBeforeDue: rule.daysBeforeDue, templateId },
      });
    }

    for (const rule of notificationRuleSeeds) {
      await tx.notificationRule.upsert({
        where: { code: rule.code },
        update: {},
        create: rule,
      });
    }

    for (const role of roleSeeds) {
      await tx.role.upsert({
        where: { code: role.code },
        update: { name: role.name, description: role.description },
        create: role,
      });
    }

    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (email && password) {
      if (password.length < 12) {
        throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
      }
      const adminRole = await tx.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
      const user = await tx.user.upsert({
        where: { email },
        update: { active: true },
        create: {
          email,
          displayName: 'Initial Administrator',
          passwordHash: await hash(password),
        },
      });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
        update: {},
        create: { userId: user.id, roleId: adminRole.id },
      });
    } else if (email || password) {
      throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be supplied together.');
    }
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database seed failed.');
    await prisma.$disconnect();
    process.exitCode = 1;
  });
