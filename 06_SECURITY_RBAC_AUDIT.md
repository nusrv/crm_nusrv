# Security, RBAC and Audit

## 1. Security baseline

Required:
- HTTPS only in production
- secure session cookies
- CSRF protection
- CAPTCHA on login
- rate limiting
- brute-force/account lockout controls
- strong password policy
- MFA capability
- least-privilege RBAC
- encrypted integration credentials
- masked secrets in UI
- database backups
- audit events
- environment separation
- dependency/security patch process

## 2. Roles

### Admin
Full platform configuration and emergency privileges.

### Accountant
- view customers/subscriptions
- review invoice draft
- publish invoice
- view Fawtara result
- confirm/reject payment
- complete financial renewal decision

### IT
- view relevant customers/subscriptions
- view technical connections
- approve suspension
- approve reactivation
- execute/confirm manual technical actions
- view integration errors

### Sales Development
- manage retention cases
- contact rejected customers
- record outcome
- route upgrade opportunities

### Management
- dashboard/report access
- escalation visibility
- explicit intervention rights only where assigned

## 3. Separation of duties

Initial V1 can permit Admin override, but:
- require a reason,
- capture actor and timestamp,
- create audit event.

Accountant publication and IT suspension are distinct authorities.

## 4. Sensitive data

Never display or log:
- full API keys
- Fawtara secret keys
- SmarterMail/Plesk passwords
- database passwords
- SMTP credentials

Use application encryption or external secret management.

## 5. Audit

Audit events are append-only from the application perspective.

Audit examples:
- customer imported/edited
- renewal case created
- reminder queued/sent/failed
- inbound reply received
- AI classification created/corrected
- customer acceptance/rejection recorded
- invoice draft created
- invoice published
- Fawtara submission success/failure
- invoice email sent
- payment reported
- payment confirmed
- retention opened/closed
- suspension requested
- suspension approved/rejected
- adapter execution started/completed/failed
- manual action completed
- reactivation
- integration credentials/config changed
- role/permission changed
- login/security events

## 6. Destructive actions

No automatic deletion feature for:
- customers
- subscriptions
- domains
- hosting
- mailboxes
- Plesk subscriptions

Use soft-deactivation/closed states where appropriate.

## 7. External execution safety

Technical action executor must verify:
- correct customer
- correct subscription
- correct technical connection
- correct remote identifier
- action is allowed for service type
- approval exists
- action is not already completed
- scheduled time has arrived

Before execution, log a sanitized action fingerprint for idempotency.
