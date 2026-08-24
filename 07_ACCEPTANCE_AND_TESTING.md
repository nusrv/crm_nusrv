# Acceptance and Testing Strategy

## 1. Testing layers

Use the Node.js/TypeScript stack consistently:

- Jest unit tests for domain/application rules
- NestJS integration/e2e tests for API/RBAC/workflow behavior
- Prisma-backed database integration tests
- scheduler/idempotency tests
- BullMQ queue/job tests
- integration adapter contract tests
- mocked external API tests
- frontend component/feature tests where useful
- Playwright (or equivalent) for critical end-to-end staging scenarios before production

## 2. Mandatory scenario tests

### Renewal reminders
- D-30 sends once
- D-21 sends once
- D-14 sends once
- D-7 sends once
- D-2 sends once
- D0 sends final warning once
- rerunning scheduler does not duplicate
- accepted/rejected case no longer receives normal renewal reminders

### Acceptance
- clear acceptance creates invoice draft
- invoice cannot publish without Accountant permission
- publishing submits only through correct BillingEntity Fawtara adapter
- failed Fawtara submission does not mark invoice published/sent incorrectly

### Payment
- customer “I paid” produces PAYMENT_REPORTED only
- only authorized user can confirm payment
- confirmed payment completes financial workflow
- payment reminder job stops after confirmation

### Rejection/retention
- rejection opens retention case
- do-not-renew cannot trigger suspension before expiry + 24h
- retention recovery returns case to acceptance path

### Suspension
- IT approval required
- wrong role cannot approve
- action targets only relevant subscription connection
- SSL case cannot blindly suspend mail/hosting
- failed API action remains failed/pending, not falsely suspended
- manual provider creates manual task
- completed technical set updates subscription state

### Reactivation
- requires valid workflow trigger and IT authorization
- adapter/manual action verified
- active state only after required actions complete

### AI
- schema validation rejects malformed output
- low confidence routes to human review
- ACCEPT cannot publish invoice
- PAYMENT_REPORTED cannot confirm money
- prompt/model failure routes safely to human review

### Security
- RBAC coverage
- secrets masked
- login throttling/CAPTCHA path
- audit event for critical action

## 3. Legacy import acceptance

- raw legacy source preserved
- duplicate detection report
- ambiguous records require human mapping
- no duplicate live customer/subscription creation on re-import
- import report shows created/skipped/failed/manual-review records

## 4. Production readiness gate

Before production:
- staging environment tested
- backups verified
- queue worker/scheduler supervision configured
- SMTP/IMAP credentials verified
- Plesk sandbox/test identifiers verified
- SmarterMail non-production test verified
- Fawtara official technical configuration validated
- two BillingEntities tested separately
- production recipient guard removed only after approval
- audit/log retention configured
- health dashboard available
- rollback plan documented
