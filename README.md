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
| `app/Lorawan/`, `app/Metering/` | Uplink webhook normalising (ChirpStack/TTN), the Kalahari decoder, ingestion, alarms, meter dashboard data and the demo simulator. |
| `config/kalahari.php` | Meter specs, alarm thresholds, reporting options, volume scale and the status-bit map. |
| `resources/js/pages/` | Inertia pages: `App.tsx` (the signed-in shell) and `auth/*` (sign-in, forgot/reset password, two-factor challenge). |
| `resources/js/screens/` | One component per screen, including `Account.tsx` (password and two-factor set-up) and `Settings.tsx` (users and role access). |
| `resources/js/data/` | Demo fixtures for the fleet, clients, MDM and device dashboards. Most screens still use these; the `meters` table holds client meters for vending validation. |

### Users and roles

- **Status:** *Pending* (invited, no password yet), *Active*, or *Suspended*. Suspending someone ends their sessions straight away.
- **Admin safeguard:** an administrator can't change their own role or status, so there is always at least one active admin.
- **Two-factor sign-in:** anyone can turn it on under **My account** with an authenticator app. They get 8 recovery codes. Settings → Users shows who has it on.
- **Passwords in production:** at least 10 characters with mixed case and a number, and checked against known breaches. Elsewhere the minimum is 8 characters.

## Kalahari meters and LoRaWAN data

The platform is built around the **Kalahari Ultrasonic Water Meter** (Leeroy Systems, [user manual V1.03](docs/hardware/Kalahari_Ultrasonic_Water_Meter_User_Manual_V1.03.pdf)).

| | |
| --- | --- |
| **Hardware** | DN15, Q3 2.5 m³/h, R250, T50, PN16, IP68, motorised ball valve |
| **Prepayment** | STS Edition 2 (20-digit tokens on the CIU or infrared keypad). Credit is held on the meter as water volume (m³). |
| **Data** | The meter stores a reading every hour and sends them in packages of 1, 2, 3, 4, 6, 8 or 24 hours (the default is 24). |
| **Identifiers** | Each meter has a 13-digit **meter address**, which is also its STS meter number and its CIU binding address (Luhn check digit), plus LoRaWAN OTAA keys (DevEUI, JoinEUI, AppKey). |

### Adding a meter

Go to **Meters → + Add meter** (Admin, Ops and Field roles). The form covers:

- **Meter:** serial and meter address. The address's check digit is validated as you type.
- **LoRaWAN:** DevEUI, JoinEUI and AppKey (stored encrypted, never shown again), region, class, reporting package and sampling interval.
- **STS:** SGC, KRN and TI.
- **Installation:** plot, suburb, GPS (with **Use my location**), install date, reading at install and seal.
- **Customer:** an optional account, or leave it unassigned as stock. Vending is refused for unassigned and decommissioned meters.
- **Commissioning checklist (from the manual):**
  - Added to the network server.
  - Out of non-reporting mode. Meters ship silent until touch-key code **11111** (D1 U1 D1 U1 D1) is entered.
  - CIU bound: the labels match, and entering **00** shows ACCEPT.
  - Valve tested.

The meter shows *Awaiting first uplink* until data arrives. Then `/meters/{serial}` shows:
- tiles that match the meter display codes (P-0 reading, P-1 flow, P-2 credit, P-A temperature, P-B battery);
- hourly and daily use;
- credit and register trends, battery and temperature;
- alarms;
- gateways and RSSI/SNR;
- the hourly frozen records in the manual's column layout (CSV export);
- the raw uplink log.

### Connecting the network server

The network server (ChirpStack v4 or The Things Stack v3) holds the session keys and **decrypts** each frame. It then forwards the application payload to:

```
POST https://your-domain/api/lorawan/uplink
Authorization: Bearer <LORAWAN_WEBHOOK_TOKEN>      (or X-Api-Key)
```

- **ChirpStack:** add an HTTP integration to the application, with event URL `…/api/lorawan/uplink` and the header above. The `up` and `join` events are used; the others are acknowledged and ignored.
- **The Things Stack:** add a custom webhook with the same header, and enable *Uplink message* and *Join accept*.

Every frame is stored in `uplinks` with its raw payload (hex), radio metadata and decode status:

| Decode status | Meaning |
| --- | --- |
| `decoded` | Readings were written. |
| `undecoded` | Nothing could decode it yet. |
| `error` | The decoded data was malformed. |
| `unknown_device` | No meter has that DevEUI. |
| `join` | A join event. |

Hourly records are unique per meter and hour, so repeated packages don't double count.

### Payload format (pending the Kalahari protocol document)

The byte layout is in the separate *Kalahari Ultrasonic Water Meter Communication Protocol*, which we don't have yet. Until it arrives, either route works:

1. **Codec on the network server (recommended).** Write the ChirpStack/TTN payload codec from the protocol so it outputs this object:

   ```json
   {
     "records": [
       { "time": "2026-10-20T08:00:00Z", "Total+": 69.9, "Flow+": 0, "Vol-RTU": 3.68, "Voltage": 0,
         "Water Temp": 21.4, "Status": 66, "Consume": 0, "Total-": 1.2, "Flow-": 0 }
     ],
     "remainingVolume": 4.2,
     "valve": "open",
     "alarms": ["leakage"],
     "firmware": "KU-1.03"
   }
   ```

   - **Field names:** the manual's column names, as above, or camelCase (`totalForward`, `flowForward`, `rtuVoltage`, `meterVoltage`, `temperature`, `status`, `consumption`, `totalReverse`, `flowReverse`).
   - **`time`:** ISO 8601, epoch seconds, or the meter's own `yy/mm/dd hh` (read as Gaborone time). Without times, records are taken as consecutive hours ending at the hour the uplink was received.
   - **`consumption`:** if missing, it is worked out from the register.
2. **Decoder in this app.** Implement `App\Lorawan\KalahariDecoder::decodeBytes()`, then run `php artisan mdms:redecode` to decode every stored frame that is still undecoded.

**Units:** volumes are taken as m³. The manual's sample table looks like it could be litres. Once the protocol confirms the unit, set `KALAHARI_VOLUME_SCALE=0.001` if needed.

**Status bits:** the meaning of the `Status` byte goes in `config/kalahari.php` → `status_bits`. Until then the dashboard shows it in hex.

### Alarms

Alarms are opened and cleared automatically as packages arrive. Ones the meter reports in `alarms` are labelled *from meter*. The platform also derives these from the hourly records:

| Alarm | Raised when |
| --- | --- |
| Burst | Flow is above 1.25 × Q3. |
| Leak | Water flowed every hour for 24 hours. |
| Reverse flow | There is reverse flow. |
| Low battery | Battery is below 3.40 V. |
| Low credit | Credit is at or below 1 m³. |
| Credit exhausted | Credit has run out. |

Thresholds are in `config/kalahari.php`.

### Demo data

With `MDMS_DEMO=true`:
- the seeder simulates two weeks of uplinks for the demo meters through the same pipeline;
- each meter page has a **Simulate uplinks** button.

The vending validation API also accepts the 13-digit meter number. It now uses the meter's live state (last uplink, battery, valve, credit).

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

## Hosting on your own Ubuntu VPS

`deploy/` sets the app up on a fresh Ubuntu 22.04 or 24.04 server (no cPanel). Production is
**https://metering.leeroysystems.co.bw**, a HostGator VPS at 129.121.95.203.

1. **Point DNS at the server.** Add an A record for the domain → the VPS IP, and wait until `getent hosts metering.leeroysystems.co.bw` on the VPS shows that IP.
2. **Run the setup script** on the VPS as root:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/Oteesworld/mdms/main/deploy/setup.sh   # or copy it over with scp
   sudo LETSENCRYPT_EMAIL=you@leeroysystems.co.bw bash setup.sh
   ```

   Pass `BRANCH=amplified-iot-app` if the PR isn't merged yet. The script:
   - installs PHP 8.4, MySQL 8, Nginx, Node 22, Composer and certbot;
   - turns on the firewall (SSH/HTTP/HTTPS only);
   - creates an `mdms` user and a PHP-FPM pool that runs as it;
   - creates a GitHub deploy key and **pauses so you can add it** under the repo's Settings → Deploy keys;
   - clones into `/var/www/mdms` and creates the database and `.env`, with a random DB password, `VENDING_API_KEY` and `LORAWAN_WEBHOOK_TOKEN`;
   - builds, migrates and gets a Let's Encrypt certificate.
3. **Create the first administrator:** `sudo -u mdms php /var/www/mdms/artisan mdms:create-admin`
4. **Set up mail.** Set `MAIL_*` in `/var/www/mdms/.env` (SMTP, Resend, Mailgun…), then run `sudo -u mdms php /var/www/mdms/artisan config:cache`.
5. **Point ChirpStack at the app.** In ChirpStack (`teemane.leeroysystems.co.bw`), go to Applications → *your application* → Integrations → **HTTP** and set:
   - **Payload encoding:** JSON
   - **Event endpoint URL:** `https://metering.leeroysystems.co.bw/api/lorawan/uplink`
   - **Header:** `Authorization` = `Bearer <LORAWAN_WEBHOOK_TOKEN from .env>`

   Then register each meter on the **Meters** screen with the same DevEUI, JoinEUI and AppKey you give it in ChirpStack.

To deploy later changes, run `sudo -u mdms bash /var/www/mdms/deploy/update.sh`. It runs in maintenance mode while it pulls, installs, builds, migrates and caches, then reloads PHP-FPM.

**Where to look when something breaks:**
- `/var/www/mdms/storage/logs/laravel.log`
- `/var/log/nginx/error.log`
- `journalctl -u php8.4-fpm`

Live mode (`MDMS_DEMO=false`) starts with no meters, users or vending log; everything comes from registration and uplinks.

## Deploying on Laravel Forge (alternative)

1. **Create the server.** In Forge, create a server with PHP 8.4, MySQL (or Postgres) and Node 22. Add a site for your domain with the web directory `/public`.
2. **Connect the repository.** Choose `Oteesworld/mdms` and the `main` branch, then enable **Quick deploy**.
3. **Set the environment.** Under **Site → Environment**, start from `.env.example` and set:
   - `APP_ENV=production`, `APP_DEBUG=false` and `APP_URL=https://your-domain`.
   - `DB_CONNECTION=mysql`, plus the database name, user and password Forge created.
   - Mail settings (`MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`). Invitations and password resets are sent by email.
   - `VENDING_API_KEY`: a long random value (`openssl rand -hex 32`). Share it with the vending system's team.
   - `LORAWAN_WEBHOOK_TOKEN`: another long random value. Put it in the network server's webhook header.
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
