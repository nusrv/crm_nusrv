# Master Plan
## Customer Subscription Lifecycle Control Panel

## 1. Objective

Replace the legacy Excel-driven renewal process with a controlled internal CP that can:

- maintain customer and subscription records,
- monitor renewal dates,
- send scheduled customer reminders,
- detect and classify customer replies,
- route acceptance/rejection/questions to the correct workflow,
- prepare official invoices,
- integrate with Jordan Fawtara after accountant publication,
- follow up for payment,
- record human payment confirmation,
- coordinate retention attempts,
- suspend/reactivate only the affected service,
- use Plesk and SmarterMail APIs when available,
- create manual IT tasks where no API exists,
- notify internal roles at configurable escalation levels,
- retain an immutable audit history.

## 2. Scope

### In scope

- Internal authenticated CP
- Customer master
- Billing entities
- Service types
- Subscriptions
- Renewal cases
- Configurable reminder rules
- Customer communication templates
- SMTP sending
- IMAP mailbox monitoring
- SmarterMail integration
- LLM email classification
- Invoice drafts
- Fawtara integration
- Payment collection workflow
- Retention workflow
- Action/approval queue
- Plesk integration
- Manual technical action adapter
- Suspension/reactivation
- Internal notifications
- Audit log
- Reports and dashboards
- Legacy Excel import/migration

### Out of scope for V1

- General CRM
- Customer portal
- Full accounting ERP
- Bank API reconciliation
- Payment gateway
- WhatsApp
- SMS
- Mobile application
- Marketing automation
- Helpdesk/ticketing platform
- Autonomous AI agent with unrestricted actions
- Automatic deletion of resources

## 3. Core business entities

- BillingEntity
- Customer
- Contact
- ServiceType
- Subscription
- TechnicalConnection
- SubscriptionConnection
- RenewalCase
- ReminderRule
- CommunicationThread
- EmailMessage
- AiClassification
- Invoice
- InvoiceLine
- PaymentRecord
- RetentionCase
- ApprovalRequest
- TechnicalAction
- NotificationRule
- User
- Role
- AuditEvent
- IntegrationHealthEvent

## 4. Main operating flow

### Positive renewal

Active subscription
→ renewal window
→ reminders
→ customer accepts
→ invoice draft
→ accountant review
→ accountant publishes
→ Fawtara official submission
→ official invoice sent
→ collecting payment
→ customer may report payment
→ accountant confirms payment received
→ fulfilled
→ next renewal cycle scheduled

### Rejection

Customer rejects
→ retention workflow
→ internal Sales/IT/Management follow-up
→ recovered OR lost
→ if lost: do-not-renew
→ expiry warning
→ expiry + 24h
→ suspension due
→ IT approval
→ automatic adapter action or manual IT task
→ verify
→ suspended

### Ambiguous reply

Inbound email
→ thread matching
→ LLM classification
→ low confidence/question/upgrade/complaint
→ human review
→ operator chooses valid workflow transition

## 5. Reminder policy

Customer renewal reminders:
- D-30
- D-21
- D-14
- D-7
- D-2
- D0 final warning

D0 message states suspension may occur after 24 hours.

Internal escalations are configurable. Initial concept:
- D-2: IT notification
- D0: IT + CEO/management
- failed suspension/API action: IT + Admin/management

Payment collection reminder timing is configurable and must not be hard-coded before business timing is finalized.

## 6. Service types

Initial service types:
- Domain
- SSL
- Hosting
- Dedicated Server
- Support
- Antivirus

ServiceType is administrator-configurable so future services require no schema/code change.

## 7. Billing entities

Initial entities:

### New Serve for Digital Data Transformation
- local customers/payments
- own Fawtara credentials
- own bank details
- own invoice template/legal data

### Future foresight for Digital Data Transformation
- international customers/payments
- separate Fawtara account/configuration
- own bank details
- own invoice template/legal data

Every customer is assigned to exactly one billing entity.

## 8. Technical connection model

Connections are independent from customers/subscriptions.

Examples:
- PLESK-SRV-01
- PLESK-SRV-02
- SMARTERMAIL-01
- DOMAIN-REGISTRAR-MANUAL
- EXTERNAL-SSL-MANUAL

A subscription can map to multiple connections.

Example:
- Hosting subscription → PLESK-SRV-01
- Email subscription → SMARTERMAIL-01
- Combined commercial plan → several service subscriptions/connections

Each mapping stores the remote identifier and supported actions.

## 9. Human approval gates

### Accountant
- review invoice draft
- publish invoice
- confirm funds received
- renewal/financial completion

### IT
- approve suspension
- approve reactivation
- complete manual technical actions

### Sales Development
- manage retention cases
- follow up on rejected renewals
- handle upgrade/commercial opportunities

### Admin
- full access
- configuration
- integrations
- roles
- emergency override with mandatory reason

### Management
- dashboards
- escalations
- intervention based on assigned permissions

## 10. Development phases

0. Foundation, repository, schema skeleton, architecture
1. Core CP and legacy data import framework
2. Renewal engine and notifications
3. SmarterMail/SMTP/IMAP + LLM classification
4. Fawtara and invoice publication
5. Collection/payment workflow
6. Technical action engine: Plesk/SmarterMail/manual + suspension/reactivation
7. Reporting, reconciliation, hardening and production readiness
8. Optional MCP interface for agent/n8n/Codex/ChatGPT interoperability

## 11. Success criteria

The system is successful when a subscription can travel from active state through renewal reminders, customer reply, invoicing, collection and completion — or rejection, retention and controlled suspension — without relying on the Excel workbook for day-to-day operation, while maintaining human control and a complete audit trail.
