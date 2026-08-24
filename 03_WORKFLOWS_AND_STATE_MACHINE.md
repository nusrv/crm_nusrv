# Workflows and State Machine

## 1. Separate state domains

Do not use one giant status field for everything.

### Subscription status
- ACTIVE
- SUSPENDED
- CLOSED

### RenewalCase status
- UPCOMING
- REMINDER_CYCLE
- AWAITING_CUSTOMER
- HUMAN_REVIEW
- ACCEPTED
- INVOICE_DRAFT
- INVOICE_PENDING_PUBLICATION
- INVOICE_PUBLISHED
- COLLECTING
- PAYMENT_REPORTED
- PAYMENT_CONFIRMED
- FULFILLED
- REJECTED
- RETENTION
- DO_NOT_RENEW
- SUSPENSION_DUE
- SUSPENSION_PENDING_APPROVAL
- SUSPENSION_IN_PROGRESS
- SUSPENDED
- REACTIVATION_PENDING
- CLOSED
- ERROR

### Invoice status
- DRAFT
- PENDING_PUBLICATION
- PUBLISHED
- SENT
- PAYMENT_REPORTED
- PAID
- FAILED
- VOIDED/CANCELLED only when valid business/Fawtara procedure is implemented

### TechnicalAction status
- DRAFT
- PENDING_APPROVAL
- APPROVED
- QUEUED
- EXECUTING
- MANUAL_PENDING
- SUCCEEDED
- FAILED
- CANCELLED

## 2. Renewal reminder flow

Daily scheduler:
1. locate active subscriptions with upcoming renewal dates,
2. ensure current-cycle RenewalCase exists,
3. calculate milestone,
4. ensure milestone has not already been sent,
5. ensure case is in a state that allows renewal reminders,
6. queue message,
7. write audit event.

Milestones:
- -30 days
- -21 days
- -14 days
- -7 days
- -2 days
- 0 days final warning

Scheduler must be idempotent. Running twice must not duplicate reminders.

## 3. Customer acceptance

Inbound reply
→ thread/case match
→ AI classification
→ if clear ACCEPT:
  - stop renewal reminder cycle
  - mark accepted
  - create invoice draft
  - notify Accountant
→ accountant reviews
→ accountant publishes
→ Fawtara submission
→ official invoice generated/recorded
→ send invoice + correct billing entity bank details
→ COLLECTING

The LLM cannot publish.

## 4. Payment flow

During COLLECTING:
- send configurable payment reminders
- inbound “paid/transferred/check ready”:
  - set PAYMENT_REPORTED
  - notify Accountant
- Accountant verifies funds:
  - PAYMENT_CONFIRMED
  - FULFILLED
  - schedule next renewal cycle/renewal date update per approved business rule

A customer email alone never confirms funds.

## 5. Customer rejection

Clear REJECT:
→ stop customer renewal reminders
→ REJECTED
→ create RetentionCase
→ RETENTION
→ assign/notify configured Sales Development, IT, Management

Possible outcome:
- recovered → return to ACCEPTED path
- lost → DO_NOT_RENEW

DO_NOT_RENEW does not immediately suspend.

## 6. Suspension

At due date:
- send final customer warning
- notify configured internal escalation

At due date + 24 hours, if:
- case is DO_NOT_RENEW or otherwise legitimately unpaid/non-renewing according to policy,
- no valid hold exists,
- subscription is active,

then:
→ SUSPENSION_DUE
→ create approval request for IT
→ SUSPENSION_PENDING_APPROVAL

After IT approval:
→ build service-specific TechnicalAction set
→ for each connection:
  - API adapter if supported
  - Manual task if not
→ verify action result
→ only when required actions succeed/are confirmed:
  - subscription SUSPENDED
  - renewal case SUSPENDED

Do not suspend unrelated subscriptions.

## 7. Reactivation

Trigger: valid payment/management decision after suspension.

→ REACTIVATION_PENDING
→ IT approval
→ service-specific actions
→ verify each required connection
→ subscription ACTIVE
→ renewal case FULFILLED or CLOSED according to cycle outcome

## 8. Ambiguous/complex customer reply

Examples:
- asks for clarification
- asks for upgrade
- asks to change plan
- disputes price
- complaint
- refers to several services
- low AI confidence

Flow:
→ HUMAN_REVIEW
→ AI provides summary + suggested reply only
→ assigned user decides action
→ user sends/approves response
→ workflow resumes through explicit transition

## 9. Holds

Support a workflow hold flag/reason so authorized staff can temporarily stop:
- customer reminders,
- payment reminders,
- suspension execution.

Hold must have:
- reason
- actor
- timestamp
- optional expiry
- audit event.
