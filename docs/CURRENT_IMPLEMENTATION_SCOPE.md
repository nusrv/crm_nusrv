\# Current Implementation Scope



\*\*Project:\*\* NUSRV CRM  

\*\*Purpose of this file:\*\* This is the authoritative scope for the current implementation cycle.



When this file conflicts with older planning documents, historical phase documents, or previous implementation assumptions, \*\*this file governs the current cycle\*\* unless the owner explicitly changes a rule.



Do not expand the scope automatically.



\---



\## 1. Product Role



The CRM is currently a:



\- customer management system

\- subscription tracking system

\- renewal operations system

\- communication system

\- invoice preparation and record system

\- payment tracking system

\- receipt system



The CRM is \*\*not\*\* currently responsible for technically renewing, activating, suspending, or terminating external services.



No Plesk, SmarterMail, hosting, domain, or similar technical service action is triggered by the renewal/payment workflow.



Technical service suspension, when needed, is performed manually outside the CRM.



\---



\## 2. Current Frozen Business Rules



\### Renewal



Customer acceptance of renewal:



\- records the customer's commercial decision

\- calculates the proposed next renewal period/date

\- does \*\*not\*\* immediately overwrite the Subscription renewal date



The Subscription renewal tracking date is committed only when a human later performs:



\*\*Mark Renewal Fulfilled\*\*



This action is CRM tracking only and does not technically renew any external service.



\### Payment



Payment does not control service renewal.



A service may renew externally while the invoice remains:



\- unpaid

\- partially paid

\- fully paid



CRM must not automatically suspend or renew a service based on payment status.



\### Human Control



Critical workflow decisions are human-triggered.



No automatic acceptance/rejection based on email content.



\---



\## 3. AI Is Excluded From Current Operations



AI must not participate in the current operational workflow.



AI must not:



\- classify customer replies

\- write customer emails

\- suggest replies

\- send replies

\- accept renewals

\- reject renewals

\- create invoices

\- classify payments

\- trigger actions



Existing AI architecture may remain in the repository but must stay disabled/deferred.



AI settings may be placed under Advanced/System Settings.



\---



\## 4. Session Requirement



The effective authenticated user session should remain usable for up to:



\*\*24 hours\*\*



Use the existing secure access-token + refresh-session architecture.



Do not simply create a 24-hour privileged access token if silent refresh can provide the same UX safely.



Required behavior:



\- silent refresh

\- logout revocation

\- disabled user cannot refresh

\- expired refresh session requires login

\- current roles are re-evaluated during refresh



\---



\## 5. Renewals Operational Workflow



The approved workflow is:



Upcoming Renewal  

→ Prepare Reminder  

→ Review Email  

→ Human Send  

→ Waiting for Customer  

→ Customer Reply Detected  

→ Human Reviews Reply  

→ Accept Renewal / Do Not Renew / Needs Clarification  

→ Accepted Renewal  

→ Proposed Renewal Period  

→ Create Invoice  

→ Invoice / Collection workflow  

→ Human Mark Renewal Fulfilled  

→ Subscription tracking renewal date updated



No technical service action occurs from this workflow.



\---



\## 6. Renewal Reminder



Customer reminders are manually prepared and manually sent.



The Renewals page should provide:



\*\*Prepare Reminder\*\*



The system prepares a deterministic message using CRM data.



The operator reviews:



\- recipient

\- subject

\- body

\- renewal information



Then explicitly presses:



\*\*Send Email\*\*



Sending must never happen automatically merely because a renewal date is reached.



Repeated reminders are allowed.



Show reminder history/count and last sent date.



\---



\## 7. Renewal Contact Selection



Preferred recipient resolution:



1\. active BILLING contact with valid email

2\. active PRIMARY contact with valid email

3\. authoritative primary customer email fallback where compatible with current email-resolution rules



Do not silently choose TECHNICAL or MANAGEMENT contacts.



If no valid renewal contact exists, show a clear warning and link/action to customer contacts.



\---



\## 8. Email Reply Detection



Reuse the existing communication infrastructure.



Primary correlation mechanisms:



\- Message-ID

\- In-Reply-To

\- References

\- Communication Thread

\- Renewal Case linkage



A readable Renewal Case reference may also appear in the subject as a fallback.



Do not depend only on the subject.



When a customer replies:



\- link the reply to the correct thread

\- link it to the correct Renewal Case

\- mark it as new/unread

\- show a visible notification in Renewals

\- allow the operator to open the reply directly



No AI classification.



\---



\## 9. Human Reply Decision



Reply review must allow:



\- Accept Renewal

\- Do Not Renew

\- Needs Clarification

\- Keep in Review



The CRM must never automatically make one of these decisions from message text.



\---



\## 10. Proposed Renewal Period



When renewal is accepted:



calculate the proposed new period/date from the Subscription renewal interval.



Support existing term logic such as:



\- 12 months

\- 24 months

\- 36 months

\- 60 months

\- custom interval



Do not immediately commit the new Subscription renewal date.



Commit it only on:



\*\*Mark Renewal Fulfilled\*\*



Payment status must not block fulfillment.



\---



\## 11. Invoice Creation



An accepted Renewal should expose:



\*\*Create Invoice\*\*



Known information should populate automatically from:



\- Customer

\- Billing Entity / issuer

\- Subscription

\- service

\- identifiers/domain where useful

\- renewal period

\- price

\- currency

\- tax treatment

\- issuer branding



Do not require re-entry of known subscription data.



\---



\## 12. Free / Manual Invoice



Invoices page must provide:



\*\*+ Create Invoice\*\*



With options:



\- From Active Subscription

\- Free / Manual Invoice



Free/manual invoices must not require a fake Subscription.



Support:



\- issuer selection

\- existing customer

\- manual/one-time customer

\- manual line items

\- quantity

\- unit price

\- discount

\- tax

\- currency

\- invoice date



Preserve immutable invoice snapshots.



\---



\## 13. Issuers



BillingEntity remains the legal invoice issuer.



Supported issuer types include:



\- Company

\- Individual / Personal



For normal users, do not require them to understand internal fields such as:



\- System Code

\- Customer Code Prefix



Generate these internally where safe or place them under:



\*\*Advanced / Internal Settings\*\*



Do not weaken database integrity.



\---



\## 14. Invoice Officialization



JoFotara API is deferred for the current phase.



Do not make any real JoFotara request.



The approved current workflow is manual-first:



CRM Draft  

→ Review  

→ Draft PDF if needed  

→ official invoice issued manually outside CRM  

→ operator returns to CRM  

→ enters official invoice number  

→ uploads official QR  

→ records official date/values  

→ CRM produces Official PDF



JoFotara API integration may remain implemented but disabled and moved to Advanced/Integrations settings.



\---



\## 15. Invoice PDF Rules



\### Draft



Draft invoice:



\- may be printed/exported

\- clearly displays DRAFT / NOT OFFICIAL

\- has no fabricated official invoice number

\- has no fabricated official QR



\### Official



Official invoice requires:



\- real official invoice number

\- official graphical QR

\- official values/reconciliation where required



\### Payment



Do \*\*not\*\* display:



\- Unpaid

\- Partially Paid

\- Paid

\- payment history



on the invoice PDF.



Payment information belongs only in CRM operational views.



\---



\## 16. Invoice Visual Reference



For NUSRV, the current highest-priority visual reference is:



`docs/templates/nusrv\_invoice\_latest\_reference.pdf`



Also retain older references under:



`docs/templates/`



The shared invoice renderer should closely follow the approved real invoice design.



Important elements include:



\- logo size and placement

\- English/Arabic issuer identity

\- issuer address

\- customer block

\- Electronic Invoice Number

\- invoice metadata

\- Sales Tax No.

\- line-item table

\- totals

\- bank details

\- footer/contact details

\- page number

\- A4 print layout



\---



\## 17. Sales Tax Number Rule



In the approved invoice design:



\*\*Sales Tax No. displays the issuer's tax number.\*\*



Use:



`issuerTaxNumberSnapshot`



in the visible Sales Tax No. location.



Do not use:



`customerTaxNumberSnapshot`



for that visual field.



Do not print an extra:



`Tax / National No.`



line under the issuer address unless a future approved template specifically requires it.



Customer tax information may remain stored for legal/accounting/integration use.



\---



\## 18. Payments



Payments are independent records linked to invoices.



One invoice may have:



\- no payments

\- one partial payment

\- several partial payments

\- full payment



CRM operational status:



\- UNPAID

\- PARTIALLY PAID

\- PAID



Payment records should include:



\- amount

\- currency

\- payment date

\- method

\- reference

\- notes

\- recorded by

\- timestamp



Use exact decimal arithmetic.



Payment does not automatically change a Subscription.



\---



\## 19. Payment Receipt



Payment Receipt exists separately from the invoice.



Before an invoice exists:



\*\*Payment Receipt button is visible but disabled.\*\*



After an invoice exists:



the action becomes available.



A finalized receipt requires a real recorded Payment.



Multiple payments may produce multiple receipts.



Receipt must not contain the stamp/seal from the supplied original receipt reference.



Use the existing receipt templates under:



`docs/templates/`



\---



\## 20. Modal / Popup Rules



Global rule:



\*\*Save does not close the modal.\*\*



Every editable modal should provide:



\- top-right X

\- explicit Close button

\- visible save-success feedback



Nested modal behavior must preserve context.



Example:



Customer  

→ Customer Modal  

→ Subscription Modal



Closing Subscription returns to the same Customer Modal.



Do not redirect the operator to the Subscriptions page.



Preserve parent state and filters where practical.



Use a consistent modal-stack approach rather than isolated fixes.



\---



\## 21. UI Simplification



The current UI contains excessive internal/technical information.



Current implementation must simplify it.



Classify visible UI elements as:



\- Daily Operational

\- Business Configuration

\- Advanced / Technical

\- Unnecessary / Duplicate



Daily screens should focus on information needed to understand or perform an action.



Internal codes should not dominate the UI.



Examples to hide/move to Advanced where appropriate:



\- system codes

\- customer code prefixes

\- raw enum names

\- technical mappings

\- classification metadata

\- integration identifiers

\- database-like IDs



Do not delete necessary backend data.



Use progressive disclosure.



\---



\## 22. Navigation Direction



Primary navigation should be materially simpler.



Preferred structure:



Dashboard



Customers  

Renewals  

Invoices  

Communications



Subscriptions



Settings



Settings may contain:



\### Business

\- Service Types

\- Package Catalog

\- Currencies / Rates

\- Billing Entities



\### Renewals

\- Renewal Rules

\- Reminder Templates



\### Communications

\- Mail Settings



\### System / Advanced

\- Users / Roles

\- Technical Connections

\- Legacy Import

\- AI Settings — deferred

\- JoFotara/API Settings — deferred



Preserve RBAC.



\---



\## 23. Status Labels



Normal users should see human-readable labels.



Examples:



`AWAITING\_CUSTOMER`

→ Waiting for customer



`HUMAN\_REVIEW`

→ Needs review



`DO\_NOT\_RENEW`

→ Do not renew



Raw enum values may remain in Advanced/audit views.



\---



\## 24. Required Explanations



If a technical/business field must remain visible, provide short helper text.



Examples:



\*\*Billing Entity\*\*  

The legal person/company issuing the invoice.



\*\*Renewal Interval\*\*  

How long the subscription is extended each cycle.



\*\*Technical Mapping\*\*  

Links a CRM subscription to an external system identifier. It does not perform an action by itself.



Keep explanations concise.



\---



\## 25. Safety / Architecture Constraints



Do not weaken:



\- RBAC

\- audit trails

\- invoice snapshots

\- branding snapshots

\- payment history

\- communication threading

\- renewal transition rules

\- billing-entity isolation

\- customer-code integrity



UI simplification means hiding complexity, not deleting required business/data integrity.



\---



\## 26. Current Deferred Scope



Do not implement or activate:



\- AI operational workflows

\- automatic customer reply decisions

\- automatic service renewal

\- automatic service suspension

\- Plesk execution

\- SmarterMail execution

\- real JoFotara API submission

\- Telegram notifications

\- unrelated dependency upgrades



\---



\## 27. Development Efficiency Rules



To conserve Codex usage:



\- do not re-analyze the whole repository for every slice

\- inspect only directly relevant files/dependencies

\- reuse existing architecture

\- use focused tests during development

\- run the full regression suite once at the end

\- avoid repeated full builds during small edits

\- avoid long progress reports

\- defer broad documentation cleanup until implementation is stable

\- make logical local commits

\- never restart completed work from scratch



Do not run:



`npm audit fix`



or:



`npm audit fix --force`



Dependency security work is separate.



\---



\## 28. Deployment Boundary



During implementation:



\- do not push

\- do not deploy

\- do not make real JoFotara requests

\- do not use production credentials



Final implementation must be reviewed by the owner before push/deployment.



\---



\## 29. Source-of-Truth Priority



For the current implementation cycle, use this priority:



1\. Explicit new owner instruction

2\. This `CURRENT\_IMPLEMENTATION\_SCOPE.md`

3\. Current working implementation/data model

4\. Existing phase/master-plan documents

5\. Historical implementation notes



Older documentation must not override a newer frozen business rule in this file.

