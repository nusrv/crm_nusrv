# Stack Change — Laravel to Node.js/NestJS

The original build pack recommended Laravel. That recommendation has been superseded.

## Final implementation decision

Use:
- Node.js + TypeScript
- NestJS
- Next.js/React/Tailwind
- MariaDB
- Prisma
- Redis + BullMQ

Do not use Laravel/PHP.

The business requirements, data model, workflows, Fawtara logic, SmarterMail/Plesk integration strategy, LLM safety rules, RBAC, audit model and phase sequence remain unchanged.

## Aborted scaffold

If `.phase0-laravel` exists from the interrupted first Codex run, inspect it first. If it is only the untouched Laravel scaffold/dependency installation and contains no user-authored application work, it may be removed before beginning the revised Phase 0.
