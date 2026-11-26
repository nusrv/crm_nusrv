-- Existing invoices remain unassociated. Application workflows own link eligibility.
ALTER TABLE `invoices`
    ADD COLUMN `source_renewal_case_id` VARCHAR(36) NULL,
    ADD INDEX `invoices_source_renewal_case_id_idx` (`source_renewal_case_id`),
    ADD CONSTRAINT `invoices_source_renewal_case_id_fkey`
        FOREIGN KEY (`source_renewal_case_id`) REFERENCES `renewal_cases` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
