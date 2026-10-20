#!/usr/bin/env bash
#
# One-time setup of Amplified IoT on a fresh Ubuntu 22.04 / 24.04 server (no cPanel).
#
#   sudo LETSENCRYPT_EMAIL=you@leeroysystems.co.bw bash setup.sh
#
# Optional: DOMAIN (default metering.leeroysystems.co.bw), BRANCH (default main),
#           REPO (default git@github.com:Oteesworld/mdms.git).
#
# Installs PHP 8.4, MySQL, Nginx, Node 22, Composer and certbot; creates an `mdms` user,
# a database and a PHP-FPM pool; clones the repo with a read-only deploy key; builds,
# migrates and seeds; and gets an HTTPS certificate. Safe to re-run: finished steps are skipped.
set -euo pipefail

DOMAIN="${DOMAIN:-metering.leeroysystems.co.bw}"
REPO="${REPO:-git@github.com:Oteesworld/mdms.git}"
BRANCH="${BRANCH:-main}"
EMAIL="${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL for the HTTPS certificate notices}"
APP_USER=mdms
APP_DIR=/var/www/mdms
PHP=8.4

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu ]] || { echo "This script is for Ubuntu."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

step "Checking that $DOMAIN points at this server"
MY_IP=$(curl -fsS4 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
echo "This server: ${MY_IP:-unknown} · $DOMAIN resolves to: ${DNS_IP:-nothing}"
if [[ -n "$MY_IP" && "$MY_IP" != "$DNS_IP" ]]; then
  echo "DNS doesn't point here yet; the HTTPS certificate step will fail until it does."
  read -rp "Continue anyway? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || exit 1
fi

step "System packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq software-properties-common ca-certificates curl git unzip ufw nginx mysql-server certbot python3-certbot-nginx acl cron

step "PHP $PHP"
if ! command -v php$PHP >/dev/null; then
  add-apt-repository -y ppa:ondrej/php
  apt-get update -q
fi
apt-get install -yq php$PHP-fpm php$PHP-cli php$PHP-mysql php$PHP-mbstring php$PHP-xml php$PHP-curl php$PHP-zip \
  php$PHP-intl php$PHP-bcmath php$PHP-gd php$PHP-sqlite3 php$PHP-opcache php$PHP-readline
update-alternatives --set php /usr/bin/php$PHP

step "Composer"
if ! command -v composer >/dev/null; then
  EXPECTED=$(curl -fsS https://composer.github.io/installer.sig)
  curl -fsS https://getcomposer.org/installer -o /tmp/composer-setup.php
  ACTUAL=$(php -r "echo hash_file('sha384', '/tmp/composer-setup.php');")
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "Composer installer checksum mismatch"; exit 1; }
  php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer --quiet
  rm /tmp/composer-setup.php
fi

step "Node 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

step "Swap (for the front-end build on small servers)"
if [[ $(free -m | awk '/Mem:/{print $2}') -lt 3000 && ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Firewall: SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable

step "App user and deploy key"
id -u $APP_USER >/dev/null 2>&1 || useradd --create-home --shell /bin/bash $APP_USER
KEY=/home/$APP_USER/.ssh/id_ed25519
if [[ ! -f $KEY ]]; then
  sudo -u $APP_USER mkdir -p /home/$APP_USER/.ssh
  sudo -u $APP_USER ssh-keygen -t ed25519 -N '' -C "mdms@$DOMAIN" -f $KEY >/dev/null
  sudo -u $APP_USER sh -c "ssh-keyscan -t ed25519 github.com >> /home/$APP_USER/.ssh/known_hosts 2>/dev/null"
fi
if [[ ! -d $APP_DIR/.git ]]; then
  echo
  echo "Add this read-only deploy key on GitHub → Oteesworld/mdms → Settings → Deploy keys → Add deploy key:"
  echo
  cat $KEY.pub
  echo
  read -rp "Press Enter once the key is added… "
  mkdir -p $APP_DIR && chown $APP_USER:$APP_USER $APP_DIR
  sudo -u $APP_USER git clone --branch "$BRANCH" "$REPO" $APP_DIR
fi

step "MySQL database"
ENV=$APP_DIR/.env
if [[ ! -f $ENV ]]; then
  DB_PASS=$(openssl rand -hex 20)
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS mdms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mdms'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER 'mdms'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON mdms.* TO 'mdms'@'localhost';
FLUSH PRIVILEGES;
SQL

  step "Environment file"
  sudo -u $APP_USER cp $APP_DIR/.env.example $ENV
  chmod 640 $ENV
  set_env() { sudo -u $APP_USER sed -i "s|^#\? *$1=.*|$1=$2|" $ENV; grep -q "^$1=" $ENV || echo "$1=$2" | sudo -u $APP_USER tee -a $ENV >/dev/null; }
  set_env APP_ENV production
  set_env APP_DEBUG false
  set_env APP_URL "https://$DOMAIN"
  set_env LOG_LEVEL warning
  set_env DB_CONNECTION mysql
  set_env DB_HOST 127.0.0.1
  set_env DB_PORT 3306
  set_env DB_DATABASE mdms
  set_env DB_USERNAME mdms
  set_env DB_PASSWORD "$DB_PASS"
  set_env SESSION_SECURE_COOKIE true
  set_env MDMS_DEMO false
  set_env VENDING_API_KEY "$(openssl rand -hex 32)"
  set_env LORAWAN_WEBHOOK_TOKEN "$(openssl rand -hex 32)"
fi

step "PHP-FPM pool running as $APP_USER"
cat > /etc/php/$PHP/fpm/pool.d/mdms.conf <<POOL
[mdms]
user = $APP_USER
group = $APP_USER
listen = /run/php/mdms.sock
listen.owner = www-data
listen.group = www-data
pm = dynamic
pm.max_children = 10
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 4
php_admin_value[upload_max_filesize] = 10M
php_admin_value[post_max_size] = 10M
POOL
sed -i 's/^;\?opcache.enable=.*/opcache.enable=1/' /etc/php/$PHP/fpm/php.ini
systemctl restart php$PHP-fpm

# The update script reloads PHP-FPM without needing a password.
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reload php$PHP-fpm" > /etc/sudoers.d/mdms
chmod 440 /etc/sudoers.d/mdms

step "Build and migrate"
cd $APP_DIR
sudo -u $APP_USER bash -lc "cd $APP_DIR && bash deploy/update.sh --first-run"

step "Nginx"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__APP_DIR__|$APP_DIR|g" $APP_DIR/deploy/nginx.conf > /etc/nginx/sites-available/mdms
ln -sf /etc/nginx/sites-available/mdms /etc/nginx/sites-enabled/mdms
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

step "HTTPS certificate"
certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m "$EMAIL" -n || echo "certbot failed. Fix DNS, then run: certbot --nginx -d $DOMAIN --redirect"

step "Scheduler"
echo "* * * * * $APP_USER cd $APP_DIR && php artisan schedule:run >> /dev/null 2>&1" > /etc/cron.d/mdms

TOKEN=$(grep '^LORAWAN_WEBHOOK_TOKEN=' $ENV | cut -d= -f2)
cat <<DONE

Done: https://$DOMAIN

Next:
  1. Create the first administrator:
       sudo -u $APP_USER php $APP_DIR/artisan mdms:create-admin
  2. Mail for invitations and password resets: set MAIL_* in $ENV, then
       sudo -u $APP_USER php $APP_DIR/artisan config:cache
  3. ChirpStack (teemane.leeroysystems.co.bw) → Applications → your application → Integrations → HTTP:
       Payload encoding:   JSON
       Event endpoint URL: https://$DOMAIN/api/lorawan/uplink
       Header:             Authorization = Bearer $TOKEN
  4. Later updates:  sudo -u $APP_USER bash $APP_DIR/deploy/update.sh

The vending API key and the webhook token are in $ENV.
DONE
