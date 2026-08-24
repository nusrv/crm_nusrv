# ADR-003 — MariaDB Retarget

## Status

Accepted — supersedes the database-engine portions of ADR-001 and ADR-002.

## Decision

The application database is MariaDB hosted through Plesk. Prisma 7 continues to own the schema and
uses its `mysql` datasource provider with the official `@prisma/adapter-mariadb` driver adapter.
Application configuration retains Prisma's canonical `mysql://` URL; the database bootstrap changes
only the scheme passed to the MariaDB driver because that driver expects `mariadb://`.

The minimum supported server version is MariaDB 10.6. Development Compose uses MariaDB 10.11 LTS.
The schema deliberately relies only on conservative features available in MariaDB 10.6: InnoDB
foreign keys, inline enums, `JSON`, fixed-precision decimal, fractional `DATETIME`, and row triggers
using `SIGNAL SQLSTATE`.

## Storage mappings

- UUID identities remain application/Prisma-generated RFC 4122 UUID strings and are stored as
  `VARCHAR(36)`. Entity identity semantics do not change.
- Audit IP addresses use `VARCHAR(45)`, which safely fits canonical IPv4 and IPv6 text.
- Logical Prisma `Json` fields map to MariaDB `JSON`.
- Money remains `DECIMAL(14,3)`; subscription calendar values remain `DATE`; timestamps remain
  millisecond-precision `DATETIME(3)`.
- Audit events remain append-only at the database boundary. MariaDB `BEFORE UPDATE` and
  `BEFORE DELETE` triggers raise SQLSTATE `45000` for every attempted mutation.

## Migration history

No production deployment or production data existed at the time of the decision. The three
development-only PostgreSQL migrations were therefore replaced by one canonical migration,
`20260823000000_mariadb_phase_0_1_foundation`, which creates the complete approved Phase 0 and
Phase 1 schema from an empty MariaDB database. This ADR preserves the logical history of that
replacement; PostgreSQL SQL is not retained as a deployable application migration path.

## Verification policy

The normal local suite statically validates the Prisma mappings and generated migration contract.
`MARIADB_TEST_DATABASE_URL` enables the separate live integration suite and must point to a
disposable database whose name ends in `_test`. That suite resets only that guarded database,
applies the canonical migration from zero, then verifies Prisma CRUD, constraints, JSON, decimal,
UUID, IPv6, audit immutability, legacy staging idempotency, and transactional approval behavior.
Plesk/staging must run that live suite before production deployment.
