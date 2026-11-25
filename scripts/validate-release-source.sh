#!/usr/bin/env bash
# Run only from a separate, clean source checkout; never the live application.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f package-lock.json && -f apps/api/prisma/schema.prisma ]] || { echo 'Run from the CRM source checkout.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Refusing a dirty source checkout.' >&2; exit 1; }
shopt -s nullglob
for file in .env* apps/api/.env* apps/web/.env*; do
  [[ "$file" == *.example ]] || { echo "Refusing environment file in source-check checkout: $file" >&2; exit 1; }
done
shopt -u nullglob
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)'
chrome="${P0_TEST_CHROME:-}"
if [[ -z "$chrome" ]]; then
  chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi
[[ -n "$chrome" && -x "$chrome" ]] || { echo 'Chrome/Chromium is required for the pre-release browser test. Set P0_TEST_CHROME to its executable.' >&2; exit 1; }
echo "Source validation commit: $(git rev-parse HEAD)"
# No inherited database URLs, test DB variables, provider credentials or application environment.
# Port 1 is a deliberately unusable local dependency endpoint, not a test schema.
env -i PATH="$PATH" HOME="$HOME" TZ=Asia/Amman CI=true NEXT_TELEMETRY_DISABLED=1 \
  NODE_ENV=test APP_URL=http://127.0.0.1:3000 WEB_URL=http://127.0.0.1:3000 API_URL=http://127.0.0.1:3001 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:3001 DATABASE_URL=mysql://example:example@127.0.0.1:1/unconnected_ci \
  REDIS_URL=redis://127.0.0.1:1 CAPTCHA_PROVIDER=mock CAPTCHA_TEST_TOKEN=isolated-source-validation \
  JWT_ACCESS_SECRET=source-only-access-key-not-for-production JWT_REFRESH_SECRET=source-only-refresh-key-not-for-production \
  ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  SMTP_MODE=mock IMAP_MODE=mock AI_PROVIDER=mock FAWTARA_MODE=mock PLESK_MODE=mock SMARTERMAIL_MODE=mock \
  MAIL_WORKERS_PAUSED=false P2_ACTION_QUEUE_ENABLED=false P2_DSN_REVIEW_CAPTURE_ENABLED=false P2_SENT_OBSERVATION_ENABLED=false \
  P0_TEST_CHROME="$chrome" P0_TEST_PROCESS_RESTART=1 P0_TEST_NEXT_UI=1 \
  bash -euo pipefail -c '
    npm ci --include=dev --no-audit --no-fund
    npm run db:generate
    (cd apps/api && ../../node_modules/.bin/prisma validate)
    npm run typecheck
    npm run lint
    npm run test -w @cp/api -- --testPathIgnorePatterns="mariadb.*live[.]spec[.]ts$"
    mapfile -t contracts < <(git ls-files "apps/api/**/*.test.mjs" "apps/web/**/*.test.mjs")
    (( ${#contracts[@]} > 0 ))
    node --import tsx --test "${contracts[@]}"
    (cd apps/api && ../../node_modules/.bin/tsx ../web/tests/payment-receipt-renderer.check.tsx && ../../node_modules/.bin/tsx ../web/tests/invoice-branding-renderer.check.tsx)
    NODE_ENV=production npm run build
  '
echo 'Source validation PASSED (no database rehearsal, deployment or live mail).'
