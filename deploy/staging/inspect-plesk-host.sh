#!/usr/bin/env bash
set -eu

echo '== Operating system =='
uname -a
test -r /etc/os-release && sed -n '1,12p' /etc/os-release

echo '== Identity and SSH privilege =='
id
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  echo 'passwordless_sudo=yes'
else
  echo 'passwordless_sudo=no'
fi

echo '== Plesk and Node.js =='
command -v plesk >/dev/null 2>&1 && plesk version || echo 'plesk=not-found'
command -v node >/dev/null 2>&1 && node --version || echo 'node=not-found-in-path'
for node_bin in /opt/plesk/node/*/bin/node; do
  test -x "$node_bin" && "$node_bin" --version
done
test -d /usr/local/psa/admin/plib/modules/nodejs && echo 'nodejs_toolkit=present' || true

echo '== MariaDB and Redis =='
command -v mariadb >/dev/null 2>&1 && mariadb --version || true
command -v mysql >/dev/null 2>&1 && mysql --version || true
command -v redis-server >/dev/null 2>&1 && redis-server --version || echo 'redis-server=not-found'
command -v redis-cli >/dev/null 2>&1 && redis-cli --version || true

echo '== Supervisor =='
command -v systemctl >/dev/null 2>&1 && systemctl --version | sed -n '1p' || echo 'systemd=not-found'

if test -n "${STAGING_DOMAIN:-}" && command -v plesk >/dev/null 2>&1; then
  echo '== Plesk staging domain =='
  plesk bin site --info "$STAGING_DOMAIN"
fi
