#!/usr/bin/env bash
#
# Deploy the latest code. Run as the app user from anywhere:
#   sudo -u mdms bash /var/www/mdms/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

FIRST=0
[[ "${1:-}" == "--first-run" ]] && FIRST=1

if [[ $FIRST -eq 0 ]]; then
  php artisan down --retry=15 || true
  trap 'php artisan up' EXIT
  git pull --ff-only
fi

composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
grep -q '^APP_KEY=base64' .env || php artisan key:generate --force
npm ci --no-audit --no-fund
npm run build
php artisan migrate --force
php artisan db:seed --force          # demo data only when MDMS_DEMO=true; adds what is missing
php artisan optimize
php artisan storage:link 2>/dev/null || true

if [[ $FIRST -eq 0 ]]; then
  sudo /usr/bin/systemctl reload php8.4-fpm
fi
echo "Deployed $(git rev-parse --short HEAD)."
