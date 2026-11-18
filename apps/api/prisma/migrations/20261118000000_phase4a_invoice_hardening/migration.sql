-- Additive financial history: no deletes or draft-value rewrites.
ALTER TABLE invoices
 MODIFY status ENUM('DRAFT','READY_FOR_FAWTARA','FAWTARA_ACCEPTED','FAWTARA_REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
 ADD officialization_provenance VARCHAR(10) NULL,
 ADD cancellation_reason TEXT NULL,
 ADD cancelled_at DATETIME(3) NULL,
 ADD cancelled_by VARCHAR(36) NULL,
 ADD reconciliation_required BOOLEAN NOT NULL DEFAULT false,
 ADD reconciled_at DATETIME(3) NULL,
 ADD reconciled_by VARCHAR(36) NULL,
 ADD reconciliation_note TEXT NULL;
UPDATE invoices SET officialization_provenance = 'MANUAL' WHERE status = 'FAWTARA_ACCEPTED';
-- Existing accepted records with differing official values must receive human reconciliation.
UPDATE invoices SET reconciliation_required = true WHERE status = 'FAWTARA_ACCEPTED' AND (
 (official_currency_code IS NOT NULL AND official_currency_code <> currency_code) OR
 (official_subtotal IS NOT NULL AND official_subtotal <> subtotal) OR
 (official_discount_total IS NOT NULL AND official_discount_total <> discount_total) OR
 (official_tax_total IS NOT NULL AND official_tax_total <> tax_total) OR
 (official_grand_total IS NOT NULL AND official_grand_total <> grand_total));
