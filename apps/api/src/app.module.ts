import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { JwtAuthGuard } from './identity/jwt-auth.guard';
import { OriginGuard } from './identity/origin.guard';
import { RolesGuard } from './identity/roles.guard';
import { BillingEntitiesModule } from './modules/billing-entities/billing-entities.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { LegacyImportModule } from './modules/legacy-import/legacy-import.module';
import { RenewalCasesModule } from './modules/renewal-cases/renewal-cases.module';
import { ServiceTypesModule } from './modules/service-types/service-types.module';
import { SubscriptionConnectionsModule } from './modules/subscription-connections/subscription-connections.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { TechnicalConnectionsModule } from './modules/technical-connections/technical-connections.module';
import { QueueFoundationModule } from './queue/queue-foundation.module';
import { SecurityModule } from './security/security.module';
import { TimeModule } from './time/time.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    DatabaseModule,
    TimeModule,
    SecurityModule,
    AuditModule,
    QueueFoundationModule,
    IdentityModule,
    HealthModule,
    DashboardModule,
    BillingEntitiesModule,
    CustomersModule,
    ServiceTypesModule,
    SubscriptionsModule,
    TechnicalConnectionsModule,
    SubscriptionConnectionsModule,
    LegacyImportModule,
    RenewalCasesModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
