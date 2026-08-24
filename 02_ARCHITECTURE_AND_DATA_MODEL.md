# Architecture and Data Model

## 1. Architecture style

Use a TypeScript modular monolith.

Locked stack:
- NestJS backend
- Next.js/React/Tailwind frontend
- MariaDB
- Prisma
- Redis + BullMQ

Keep backend business modules inside the NestJS application. Do not split them into deployable microservices in V1.

Suggested backend modules:

- Identity
- Billing Entities
- Customers
- Services
- Subscriptions
- Renewal
- Communications
- AI
- Invoicing
- Collection
- Retention
- Approvals
- Technical Actions
- Integrations
- Notifications
- Audit
- Reporting
- Legacy Import

Do not split into microservices for V1.

Recommended workspace shape:

```text
apps/api/src/
  modules/
  common/
  integrations/
  jobs/
  audit/

apps/web/
  app/
  components/
  features/

packages/shared/
  contracts/
  types/
```

Prisma schema/migrations should be owned by the backend application or a clearly documented shared database package; use one canonical location only.


## 2. Layering

UI / HTTP
→ Application Services
→ Domain / Workflow Services
→ Repositories / Persistence
→ Integration Adapters / Queues

Critical state transitions must flow through a dedicated workflow service.

## 3. Recommended tables

### billing_entities
- id
- name
- code
- payment_scope (local/international)
- legal_name
- tax_number
- address
- invoice_email
- bank_details_json/encrypted fields where needed
- fawtara_config_reference
- active
- timestamps

### customers
- id
- billing_entity_id
- customer_code
- company_name
- contact_name
- primary_email
- secondary_email
- phone
- address
- country
- tax_number
- preferred_language
- status
- source_legacy_reference
- timestamps

### service_types
- id
- code
- name
- description
- active
- default_suspend_policy
- timestamps

### subscriptions
- id
- customer_id
- service_type_id
- subscription_code
- name/description
- start_date
- renewal_date
- billing_frequency
- supplier_cost
- selling_price
- currency
- provider_auto_renews (bool)
- status
- grace_hours default 24
- source_legacy_reference
- notes
- timestamps

### technical_connections
- id
- code
- name
- type (plesk, smartermail, manual, future)
- base_url/host
- credential_reference/encrypted configuration
- enabled
- environment (sandbox/production)
- capabilities_json
- last_health_status
- last_health_checked_at
- timestamps

### subscription_connections
- id
- subscription_id
- technical_connection_id
- remote_identifier
- action_profile
- metadata_json
- active
- timestamps

### renewal_cases
- id
- subscription_id
- cycle_start_date
- due_date
- status
- customer_decision
- accepted_at
- rejected_at
- do_not_renew_at
- suspension_due_at
- fulfilled_at
- closed_at
- assigned_user_id
- last_customer_contact_at
- timestamps
- unique constraint preventing duplicate renewal cycle per subscription/due date

### reminder_rules
- id
- type (renewal/payment/retention/internal)
- offset_days/hours
- template_key
- escalation_level
- enabled
- configuration_json

### communications
- id
- renewal_case_id nullable
- customer_id
- direction
- channel (email)
- external_message_id
- thread_key
- in_reply_to
- subject
- from_address
- to_addresses_json
- received_or_sent_at
- body_text
- body_html optional
- classification_status
- timestamps

### ai_classifications
- id
- communication_id
- provider
- model
- prompt_version
- intent
- confidence
- structured_result_json
- requires_human_review
- reviewed_by
- reviewed_at
- timestamps

### invoices
- id
- renewal_case_id
- billing_entity_id
- customer_id
- status
- local_invoice_number
- official_reference
- fawtara_status
- subtotal
- tax
- total
- currency
- published_by
- published_at
- sent_at
- official_payload_reference
- qr_data/reference
- error_message
- timestamps

### invoice_lines
- id
- invoice_id
- subscription_id
- description
- quantity
- unit_price
- tax_rate
- line_total

### payment_records
- id
- invoice_id
- status (reported/confirmed/rejected)
- method
- amount
- currency
- customer_reported_at
- confirmed_by
- confirmed_at
- notes
- timestamps

### retention_cases
- id
- renewal_case_id
- status
- owner_user_id
- outcome
- notes
- opened_at
- closed_at

### approval_requests
- id
- subject_type
- subject_id
- action
- requested_by
- required_role
- status
- approved_by
- approved_at
- rejected_by
- rejected_at
- reason
- timestamps

### technical_actions
- id
- renewal_case_id
- subscription_id
- subscription_connection_id nullable
- action_type
- execution_mode (api/manual)
- status
- approval_request_id
- scheduled_for
- executed_at
- attempts
- last_error
- result_summary
- timestamps

### notification_rules
- id
- event_key
- recipient_roles_json
- recipient_users_json
- recipient_emails_json
- enabled

### audit_events
- id
- actor_type (user/system/ai/integration)
- actor_id nullable
- event_key
- subject_type
- subject_id
- old_state_json
- new_state_json
- metadata_json
- ip_address nullable
- created_at
- immutable application behavior

## 4. Data rules

- Customer belongs to exactly one BillingEntity.
- Customer has many Subscriptions.
- Subscription has exactly one ServiceType.
- Subscription may have many TechnicalConnections through SubscriptionConnection.
- Each renewal cycle creates one RenewalCase.
- Invoice can contain one or several invoice lines, but lines must preserve subscription linkage.
- TechnicalAction always targets a specific subscription/service connection or an explicit manual task.
- Do not store API secrets directly in general-purpose JSON visible to application users.
- Use encrypted secret storage and mask values in UI.

## 5. Legacy Excel migration

Treat legacy workbook as untrusted/denormalized source data.

Pipeline:
1. upload/import workbook,
2. parse to staging records,
3. preserve raw row and source reference,
4. map known columns,
5. identify duplicates,
6. infer candidate customer/service splits only as suggestions,
7. present validation screen,
8. human confirms mapping,
9. create normalized records,
10. produce import report.

Do not silently split ambiguous legacy descriptions into subscriptions without human confirmation.
