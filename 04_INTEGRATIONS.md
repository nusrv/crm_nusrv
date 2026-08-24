# External Integrations

## 1. Integration architecture

Every external system must implement an adapter interface.

Do not embed external API calls directly in controllers or workflow code.

Recommended abstractions:

- MailTransport
- MailboxReader
- LlmGateway
- InvoiceAuthorityGateway
- TechnicalServiceAdapter
- HealthCheckableIntegration

## 2. SmarterMail — communications

Use:
- SMTP for outbound customer/internal email.
- IMAP for inbound mailbox synchronization and thread continuity.
- SmarterMail API for technical mail-service actions where supported.

Store:
- Message-ID
- In-Reply-To
- References
- normalized thread key
- renewal case reference
- customer/subscription reference where known

Mailbox synchronization should be incremental and idempotent.

Do not use POP as the primary design unless deployment constraints force it.

## 3. Plesk

Create PleskConnection adapter.

Capabilities may include:
- test connection
- resolve remote subscription/domain
- read status
- suspend supported hosting service
- reactivate supported hosting service
- verify action result

Never assume that suspending a Plesk subscription is correct for every service.

A Plesk action must be selected from the subscription's action profile.

## 4. SmarterMail technical actions

Create SmarterMailConnection adapter.

Potential capabilities:
- read domain/account status
- disable/enable the intended mail service scope
- verify result

Validate exact API calls against the specific installed SmarterMail version.

## 5. Manual adapter

ManualConnection is a first-class adapter.

For services/providers without API:
- generate actionable IT task,
- show customer/service/provider identifiers,
- show required action,
- require IT completion confirmation,
- capture notes/evidence/reference,
- audit completion.

Manual does not mean unmanaged.

## 6. Jordan Fawtara

Fawtara is a legal/financial integration and must have stricter controls.

Each BillingEntity has separate Fawtara configuration.

Flow:
1. application creates local invoice DRAFT,
2. Accountant reviews,
3. Accountant explicitly publishes,
4. adapter constructs the official payload according to current Jordan Fawtara technical specification,
5. submit using that BillingEntity's credentials,
6. capture official response/reference/QR data,
7. preserve submission result,
8. generate/send invoice using correct company template/bank details.

Rules:
- never submit a draft automatically,
- never reuse credentials across billing entities,
- never invent required tax fields,
- validate official API/version during Phase 4,
- support failed/rejected submission state,
- allow safe retry only where official rules permit,
- retain an auditable request/result reference without exposing secrets.

## 7. Connection configuration

TechnicalConnection should support:
- human-readable name
- adapter type
- environment
- endpoint
- encrypted credentials
- capabilities
- active flag
- test connection
- last health status

Example names:
- PLESK-01
- PLESK-02
- SMARTERMAIL-01
- REGISTRAR-MANUAL-01

## 8. Error policy

External call failure:
- do not pretend success,
- store sanitized error,
- increment bounded retry count,
- retry only safe/idempotent actions,
- create integration/technical error queue item,
- notify configured staff when threshold is reached.

## 9. Production guard

All external adapters must support explicit environment configuration.

Default development behavior:
- mock mode,
- no real email to customer addresses,
- no real Fawtara publication,
- no real suspension/reactivation.

Production execution requires explicit production configuration and credentials.
