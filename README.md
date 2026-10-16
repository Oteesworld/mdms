# Amplified IoT

Smart water metering and LoRaWAN network management for Gaborone. It is a [Laravel](https://github.com/laravel/laravel) 13 app.
The screens are React 19 + TypeScript pages served through [Inertia](https://inertiajs.com).
Sign-in, password reset and two-factor authentication use [Laravel Fortify](https://laravel.com/docs/fortify).

The original Claude Design handoff (prototype HTML and chat transcripts) is in `docs/design/`.

## Run it locally

Needs PHP 8.3+, Composer and Node 20+.

```sh
composer install
npm install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
# Optional: set MDMS_DEMO=true and MDMS_DEMO_PASSWORD=... in .env for the sample accounts
php artisan migrate --seed
npm run build            # or `npm run dev` in a second terminal while you work
php artisan serve        # http://localhost:8000
```

Without demo mode, create the first account with `php artisan mdms:create-admin`. That person then invites everyone else from **Settings → Users**.

Run the tests with `php artisan test`. The TypeScript check is `npm run typecheck`.

## How it fits together

| Where | What |
| --- | --- |
| `routes/web.php` | Every screen is served at `/{screen}` (e.g. `/map`, `/domestic/3`) by `ScreenController`. Fortify adds `/login`, `/logout`, `/forgot-password`, `/reset-password`, `/two-factor-challenge` and the `/user/...` endpoints. |
| `app/Enums/Role.php` | **Access rules.** Each role (Admin, Ops, Finance, Vendor, Field) lists the screens it may open; the first is its home screen. The server redirects anything else, and the menu only shows what the role can open. |
| `app/Http/Controllers/UserController.php` | Settings → Users: invite (emails a link to set a password), edit role/title/scope, suspend or reactivate. Admin only. |
| `app/Providers/FortifyServiceProvider.php` | Sign-in rules (suspended and not-yet-activated accounts are refused), sign-in rate limits, and the Inertia auth pages. |
| `app/Vending/MeterValidator.php` | The vending validation rules used by the API, the Vending test console and the customer portal. |
| `resources/js/pages/` | Inertia pages: `App.tsx` (the signed-in shell) and `auth/*` (sign-in, forgot/reset password, two-factor challenge). |
| `resources/js/screens/` | One component per screen, including `Account.tsx` (password and two-factor set-up) and `Settings.tsx` (users and role access). |
| `resources/js/data/` | Demo fixtures for the fleet, clients, MDM and device dashboards. Most screens still use these; the `meters` table holds client meters for vending validation. |

### Users and roles

- **Status:** *Pending* (invited, no password yet), *Active*, or *Suspended*. Suspending someone ends their sessions straight away.
- **Admin safeguard:** an administrator can't change their own role or status, so there is always at least one active admin.
- **Two-factor sign-in:** anyone can turn it on under **My account** with an authenticator app. They get 8 recovery codes. Settings → Users shows who has it on.
- **Passwords in production:** at least 10 characters with mixed case and a number, and checked against known breaches. Elsewhere the minimum is 8 characters.

## Vending validation API

Billing and STS token generation happen in the external vending system. Before it issues a token, it asks the MDMS whether the meter may be vended against, and by whom:

```http
POST /api/vending/validate
Authorization: Bearer <VENDING_API_KEY>
Content-Type: application/json

{ "meter": "WM-104091", "purchaser": "occupant", "amount": 100, "vendorRef": "OM-88213", "vendor": "Orange Money" }
```

**What comes back:**
- **Always:** `result` (`APPROVED` or `DECLINED`), a `code` and a `message`.
- **On approval:** `sts` (supply group code, key revision, tariff index), `tariff` and any `warnings` to show the cashier.

**Decline codes:** `INVALID_FORMAT`, `METER_NOT_FOUND`, `ACCOUNT_SUSPENDED`, `KYC_INCOMPLETE`, `TAMPER_HOLD`, `VENDING_NOT_PERMITTED`, `PURCHASER_NOT_PERMITTED`.

**Errors:**
- `400`: bad body.
- `401`: wrong or missing key.
- `429`: more than 600 requests a minute.
- `503`: `VENDING_API_KEY` is not set.

**Health check:** `GET /api/vending/validate`.

Every call is logged, and the log appears on the **Vending** screen. The meters it checks are seeded from `database/data/meters.json`. Regenerate that file from the front-end fixtures with `npm run fixtures`.

## Deploying on Laravel Forge

1. **Create the server.** In Forge, create a server with PHP 8.4, MySQL (or Postgres) and Node 22. Add a site for your domain with the web directory `/public`.
2. **Connect the repository.** Choose `Oteesworld/mdms` and the `main` branch, then enable **Quick deploy**.
3. **Set the environment.** Under **Site → Environment**, start from `.env.example` and set:
   - `APP_ENV=production`, `APP_DEBUG=false` and `APP_URL=https://your-domain`.
   - `DB_CONNECTION=mysql`, plus the database name, user and password Forge created.
   - Mail settings (`MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`). Invitations and password resets are sent by email.
   - `VENDING_API_KEY`: a long random value (`openssl rand -hex 32`). Share it with the vending system's team.
   - `MDMS_DEMO=false`.
4. **Use this deploy script.** It replaces Forge's default:

   ```sh
   cd $FORGE_SITE_PATH
   git pull origin $FORGE_SITE_BRANCH
   $FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader
   npm ci && npm run build
   $FORGE_PHP artisan migrate --force
   $FORGE_PHP artisan db:seed --force          # meters + vending log; safe to re-run
   $FORGE_PHP artisan optimize
   ( flock -w 10 9 || exit 1
       echo 'Restarting FPM...'; sudo -S service $FORGE_PHP_FPM reload ) 9>/tmp/fpmlock
   ```

5. **Finish setting up.** Deploy, enable **SSL → Let's Encrypt**, then create the first administrator. In Forge's **Commands** tab, run:

   ```sh
   php artisan mdms:create-admin --name="Leeroy Kgosi" --email=you@example.com
   ```

   This asks for the password. If Forge's command runner can't take input, run it over SSH instead.
6. **Optional: run a queue worker.** Mail is sent while the request runs. To send it in the background instead, set `QUEUE_CONNECTION=database` and add a Forge queue worker.
