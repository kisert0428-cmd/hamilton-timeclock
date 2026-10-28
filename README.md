# Hamilton Drywall Products — Warehouse Time Clock

A mobile-friendly React/TypeScript employee time clock with a Node/Express API, PostgreSQL, secure administrator sessions, exact payroll calculations, audited punch corrections, and Excel export. Designed for one company and fewer than 10 initial employees.

## What is included

- Employee clock in/out and multiple unpaid lunch breaks; four-digit PIN keypad; private confirmation clears after five seconds; typed PIN clears after 30 seconds of inactivity.
- Unique employee IDs and generated PINs; Argon2id PIN/password hashes. PIN lookup uses HMAC with a server secret. PINs are shown only when generated, never listed or retrievable.
- Administrator login, attendance, configurable weekly timesheets, employee activation, location assignment, missing-punch additions and corrections with required reason.
- Database transactions and per-employee row locks serialize simultaneous punches. Atomic database rate limits work across server instances. All mutations require the configured same-site Origin.
- UTC timestamps from PostgreSQL; America/New_York display; elapsed-time arithmetic handles overnight shifts, DST, midnight, and week boundaries.
- XLSX daily detail, weekly summary, correction audit, location verification and location review audit worksheets; multiple shifts and lunches retained in detail cells.
- Required server-side warehouse verification, with a default 300-foot (91.44-meter) radius. One-shot GPS is requested only when punching; precise employee coordinates are discarded. Outside readings require explicit provisional submission. Unavailable or persistently poor readings are recorded provisionally for manager review. Individually registered and revocable kiosk devices bypass GPS.
- PostgreSQL schema, tests, container build, backup script, and development-only sample employees.

**Delivery status:** the production application is live at https://hamilton-wall-systems-clock.onrender.com with managed PostgreSQL. HTTPS, database health, frontend assets, initial administrator setup availability, and protected management routes were verified on October 28, 2026. Create your first administrator at `/setup` using ADMIN_SETUP_TOKEN from your own Render service Environment page, then configure warehouse coordinates, register kiosks, and add employees. See `DEPLOYMENT.md` for the verified release. The local database remains development-only and is blocked in production.

## Prepared Render launch

`render.yaml` defines the complete low-cost deployment: one always-on 0.5 CPU/512 MB web service and one 0.1 CPU/256 MB managed PostgreSQL database with 1 GB storage, both in Virginia. Public database access is disabled. At the checked Render pricing, base compute is approximately **$13/month** ($7 web + $6 database), before additional usage, workspace charges, and tax. Review pricing in your Render account before applying.

The Blueprint has been checked against Render's current public JSON schema; Render CLI validation and actual provisioning still happen in your account. The configured private repository URL is `https://github.com/kisert0428-cmd/hamilton-timeclock`; if deploying from another repository, update its `repo` field. The GitHub integration cannot create user repositories, so create an **empty private repository** first. Source must be pushed there before applying the Blueprint. This package does not contain a live deployment or automatically authorize spending.

After the repository is connected, select **New → Blueprint** in Render, choose that repository, review the two resources, and apply. Do not also create duplicate services manually. Render generates APP_SECRET and ADMIN_SETUP_TOKEN and wires DATABASE_URL internally. The web service uses Render's documented RENDER_EXTERNAL_URL as APP_ORIGIN unless you explicitly supply APP_ORIGIN for a custom domain. The release runs migrations before deployment; the container startup also applies pending migrations safely if using it without a Blueprint.

When deployment is live:

1. Verify `/api/health` returns `{"ok":true}` over HTTPS.
2. Open the service's **Environment** page in your own Render dashboard and reveal/copy **ADMIN_SETUP_TOKEN** privately. Never put this key in a URL, repository, log, email, or chat.
3. Visit the live app's `/setup` page. Enter that setup key, your chosen administrator email, and a unique password of at least 14 characters. The endpoint is rate-limited, checks the configured origin, hashes the password, and serializes activation so only one administrator is created. Setup disables itself once any administrator exists. Existing installations cannot use this endpoint to replace an administrator.
4. Sign in at `/admin`. Remove ADMIN_SETUP_TOKEN from the Render environment after activation as additional cleanup. Use the documented release-shell recovery command for later password recovery or additional administrators.
5. Configure warehouse coordinates/radius, register trusted devices, and add real employees. No sample employees are inserted by deployment or startup.
6. Confirm the provider's automatic backup/PITR status, perform the restore drill below, and verify GPS permission/denial and punch confirmations on actual warehouse devices before employee rollout.

The `/setup` page does not send invitations or messages. You choose the administrator email during this secure activation step.

## Upgrade to required location verification

Back up the existing database, deploy this source, and **run `npm run migrate` before starting the new application**. This adds location/device/review records without deleting or rewriting existing punches. Repeat migration runs safely skip applied versions. Do not run the old release concurrently with this upgrade, because it does not enforce the new workflow.

1. Sign in at `/admin` and open **Settings**. Configure the warehouse latitude/longitude and radius in feet. The new default is **300 feet**, exactly **91.44 meters**. Existing configured radii are preserved; an unconfigured original 300-meter default changes to 300 feet. No warehouse coordinates are guessed. Until configured, phone punches are classified as GPS unavailable and recorded provisionally.
2. Re-register each warehouse device by name. Previous kiosk cookies are intentionally no longer accepted. Devices can be listed and individually revoked in Settings. The device registration cookie is an opaque credential, never a URL flag or local-storage preference. Use HTTPS and OS-level kiosk restrictions. A privileged user who extracts a device credential can copy it; this is not hardware attestation.
3. Review exceptions in **Location reviews**. Each recorded punch retains its original location classification, approximate distance rounded to 10 meters, GPS accuracy rounded up to a meter, and kiosk identity if applicable. Manager decisions require a reason and record the administrator, timestamp, previous decision, and punch correction version. An edit to a punch invalidates its previous approval, requiring a fresh review. Approvals never change original location evidence or silently delete worked time.
4. Uncompleted outside submissions and abandoned poor-accuracy retries appear as attempts, **not payable punches**. They retain their original server time. Investigate them and add a missing punch with a correction reason when appropriate; then mark the attempt reviewed with a documented reason. This keeps an audit record rather than discarding the attempt. A late employee submission is rejected explicitly after two minutes; managers can still review the retained attempt.

### Location decision policy

- Server-side Haversine distance uses the configured warehouse coordinates. Client `verified`, `kiosk`, distance, timestamp-for-punch, and similar claims are never accepted as proof.
- Verified inside requires the entire reported accuracy circle to fit inside the radius. Verified outside requires an accurate reading whose accuracy circle is entirely outside. Accuracy worse than the smaller of 50 meters or half the configured radius, zero reported uncertainty, or a circle overlapping the boundary is classified as poor accuracy. It is **not** proof the employee is outside.
- Poor initial accuracy triggers a new high-accuracy, uncached one-shot GPS request. If still poor, the server records a provisional punch with **Poor GPS Accuracy — Review Required**. If the fresh reading is reliably outside, explicit provisional submission is required.
- Readings older than two minutes, more than ten seconds in the future, missing, or invalid are unverified. Denied/unavailable GPS produces **GPS Unavailable — Review Required**. Trusted devices produce **Trusted Warehouse Kiosk**; verified phones produce **Verified at Warehouse**; outside provisional submissions produce **Outside Geofence — Review Required**.
- Provisional punches use the original attempt's server-generated timestamp, participate in the normal punch sequence and time calculations, and remain clearly flagged until reviewed. Their submission token is random, expires after two minutes, binds the employee/action/evidence on the server, and is replay-safe. Approval is an audit decision, not independent proof of location.
- Only one-shot `getCurrentPosition` calls occur, after a punch action and, if needed, its accuracy retry. There is no `watchPosition`, background tracking, or persistent storage of exact employee coordinates. Never enable request-body logging on the production proxy.

Browser GPS can be spoofed, and a client can deliberately deny permission. Geofencing is a reasonable location check **and a manager-review workflow, not tamper-proof evidence of physical presence**. PIN rate limiting, server-only decisions, conservative accuracy checks, short-lived attempt tokens, device revocation and audits reduce abuse without pretending to independently prove attendance. The documented provisional exception path intentionally allows unverified time to be recorded for review.

## Read-only visual preview

Open the separately supplied `hamilton-timeclock-preview.html` file in a browser to review the built employee clock layout, PIN keypad, management sign-in screen, and phone guidance without installing the application. Its fonts, styling, and scripts are embedded. A visible read-only banner identifies it; GPS and punch submission are disabled, and no administrator or employee records are included. This visual export is not the operational time clock.

Regenerate it after source changes with `npm run preview:layout`; the file is written beside the project directory. For a working interactive application with records, use `npm run dev:local` as described below. This environment does not provide a connected browser or remote preview forwarding.

## Fast local evaluation (no PostgreSQL installation)

Requires Node.js 22.12 or newer and npm. From this directory:

```sh
npm ci
npm run build
npm run dev:local
```

Open **http://localhost:3000**. This runs the actual application with a persistent development PostgreSQL-compatible PGlite database in `.local/database`; data survives process restarts. It starts empty. Keep this process running. Production requires managed PostgreSQL.

To create a development administrator, stop the local server first (PGlite allows one process per database), then run:

```sh
export DEV_DATABASE_PATH=.local/database
export APP_SECRET="$(cat .local/secret)"
export ADMIN_EMAIL=manager@example.com
read -rsp 'Choose admin password (14+ characters): ' ADMIN_PASSWORD
export ADMIN_PASSWORD
npm run setup:admin
unset ADMIN_PASSWORD
```

Optionally add **development-only** employees, while the local server remains stopped:

```sh
ALLOW_DEV_SEED=yes npm run dev:sample
```

This explicitly adds Alex Morgan / `1234` and Jordan Taylor / `5678`. Never use those PINs or names for real staff. No seed runs as part of build, startup, migration, or production deployment. Restart with `npm run dev:local`. Visit `/admin` to sign in.

## Development with PostgreSQL

1. Copy `.env.example` to `.env` and replace the database password and APP_SECRET. Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Install PostgreSQL 17 locally, or add `POSTGRES_PASSWORD` to `.env` and run `docker compose up -d db`. Match that password in DATABASE_URL. The Docker volume persists records. Do not expose PostgreSQL publicly.
3. Run `npm ci`, `npm run migrate`, and the administrator setup below.
4. Run `npm run build` then `npm start`; open http://localhost:3000.
5. For UI editing, run `npm run server` and `npm run dev` in separate terminals. Set APP_ORIGIN=http://localhost:5173 in `.env` and use that URL; Vite proxies `/api` to port 3000.

The backend and frontend should always share one browser origin. Do not use a permissive cross-origin API configuration.

## Deploy for employees: managed web service + PostgreSQL

The included Dockerfile works on Render, Railway, or another managed Docker host. The recommended simple setup is one always-on web service and one managed PostgreSQL database in the same region/private network. Choose a database plan with persistent storage and automatic backups. A sleeping free web service adds delays to punches; use always-on hosting for reliable warehouse operation. Plan prices and backup retention vary by provider.

1. Push this directory to a private Git repository. Exclude `.env`, `.local`, and database backups (already ignored).
2. In your provider dashboard, create managed PostgreSQL with persistent storage and daily backups. Keep public database access disabled where supported. Copy its internal connection URL into the web service's DATABASE_URL secret.
3. Create a web service from the repository using the **Dockerfile**. Port is `3000`; use `/api/health` as its health check. Deploy a single instance initially.
4. Configure the following runtime settings in the host dashboard:

| Variable         | Production value                                                                   |
| ---------------- | ---------------------------------------------------------------------------------- |
| NODE_ENV         | `production`                                                                       |
| DATABASE_URL     | Managed PostgreSQL internal URL                                                    |
| APP_SECRET       | Unique, random 32+ character secret; keep stable and back it up securely           |
| APP_ORIGIN       | Exact HTTPS URL, e.g. `https://clock.your-company.com`, no trailing slash          |
| PORT             | `3000`, or the platform-provided port                                              |
| TRUST_PROXY_HOPS | `1` for one trusted host reverse proxy; otherwise the exact documented proxy count |

Do not set DEV_DATABASE_PATH or ALLOW_DEV_SEED in production. APP_SECRET loss makes existing PIN lookup unusable; reset all PINs if the secret changes. Never include secrets in source control or build arguments.

5. Before allowing employee access, use the host's secure shell/one-off job in this same release to run `npm run migrate`. All schema operations are repeatable. The application does not create schema from employee requests. Then create the administrator using the next section.
6. Redeploy/restart once initialized. Verify `/api/health` returns `{"ok":true}`. Use the provider's HTTPS address or add your domain using the dashboard and enable automatic TLS. Distribute only the HTTPS URL. Secure cookies require HTTPS.
7. Sign in at `/admin`, add real employees, privately distribute each newly generated PIN, and verify one real test shift and Excel download. Correct the test records with a documented reason if using a real employee record; never silently delete worked time.
8. Configure backups and perform a restore test before payroll use. Export payroll and resolve review flags weekly.

Keep production migration and application database roles restricted to the service. Disable verbose request-body logging at the host, because PINs and transient coordinates are submitted in HTTPS request bodies. The app itself never logs them. Monitor host health checks and failed requests.

## Administrator setup and recovery

Run from the production release shell, with its DATABASE_URL and APP_SECRET already configured:

```sh
export ADMIN_EMAIL=payroll@your-company.com
read -rsp 'Choose admin password (14+ characters): ' ADMIN_PASSWORD
export ADMIN_PASSWORD
npm run setup:admin
unset ADMIN_PASSWORD
```

This creates the schema and the administrator. Re-running with the same email resets that administrator's password and invalidates their sessions. A different email creates another administrator. Only managers with host-shell access should run this command. Remove any setup password from dashboard environment variables immediately afterward.

Sessions expire after eight hours and use HttpOnly, SameSite=Strict cookies; Secure is enabled in production. Wrong login/PIN attempts are rate-limited for 15 minutes. Production administrators should use unique passwords stored in a password manager. There is no email password-recovery service or default administrator password.

## Manager operating guide

1. **Employees:** Add name, unique employee ID, warehouse label; save and share the generated PIN privately. Reset PIN if forgotten; the old PIN stops working immediately. Deactivate departing employees rather than deleting records. Deactivation never changes recorded time; a manager can finish an inactive employee's open shift with a reason.
2. **Overview:** Shows everyone currently working/on lunch, clock-in time, and live hours today. Open shifts and location problems appear for review. A shift past the configured threshold gets an unusually-long warning. The screen refreshes every 30 seconds. No automatic clock-out occurs.
3. **Weekly timesheets:** Select any date in the desired workweek. The week defaults to Monday–Sunday. Hours are displayed to two decimals for readability; calculations and Excel numeric values retain full precision. Click an employee to review punches.
4. **Corrections:** Select a punch or add a missing punch. Enter a full ISO timestamp with explicit offset, e.g. `2026-10-27T08:00:00-04:00`. Use `-05:00` in standard time, `-04:00` in daylight time; explicit offsets disambiguate the repeated fall hour. Require a specific correction reason. Add missing records in chronological order; the full corrected sequence must remain valid. Original database punches are immutable through the API, and every edit retains its previous effective value, corrected value, administrator, reason, and UTC correction time. Added punches retain their manager/reason in the punch record.
5. **Payroll export:** Download weekly payroll. Check all review notes before paying. Detail contains one employee/date row, with multi-line punch cells for multiple shifts/breaks, daily worked/lunch hours, and weekly totals. Weekly totals repeat on each detail row for context; **do not sum those repeated weekly columns**. Use the separate Weekly summary worksheet for payroll totals. Punch cells include full local dates and offsets; overnight shifts can appear on both affected daily rows. The correction worksheet contains correction history across all weeks for traceability.
6. **Settings:** Configure required warehouse coordinates and radius (in feet), workweek start, or long-shift threshold. Location verification cannot be disabled through settings. Changing workweek start recalculates historical report boundaries; coordinate policy changes with payroll.

## Payroll policy and incomplete shifts

Worked time is the exact elapsed time between clock-in/lunch-in and the next lunch-out/clock-out. Only actual recorded lunch-out/lunch-in intervals are counted as unpaid lunch. Multiple breaks are allowed. Clocking out while still on lunch is rejected so a manager can correct the missing lunch-in.

Every recorded work interval is split at America/New_York midnight. Weekly regular hours are capped at 40; additional actual worked hours are overtime. Overnight and workweek-crossing intervals are allocated to the day/week in which time occurred. No per-punch rounding or automatic lunch deductions are implemented. No other lunch policy is configured by default.

Unfinished intervals are excluded from payroll totals; already completed work intervals on an unfinished shift remain included and the shift is flagged. Attendance shows live elapsed time for open work intervals. **Always review incomplete shifts before final payroll.** No shift is auto-closed or worked time erased. Unusually long **closed** shifts should also be manually reviewed; the dashboard's automatic threshold warning applies to open shifts.

Location status is a review signal, not an anti-fraud guarantee. Smartphone coordinates may be inaccurate or spoofed. Unique four-digit PINs are intentionally simple and must be kept private; do not treat them as strong identity proof.

## Employee setup

Open your company's HTTPS time clock address on a phone, tablet, or warehouse computer. Enter your four-digit PIN, choose CLOCK IN, START LUNCH, END LUNCH, or CLOCK OUT, and wait for your name/action/recorded-time confirmation. The screen clears after five seconds. An error means that punch was not confirmed; ask your manager if unsure. Never assume an offline punch has been recorded; there is deliberately no offline queue or permanent browser time storage.

For a phone shortcut, use Safari → Share → Add to Home Screen, or Chrome → menu → Add to Home screen. A web manifest is included; service-worker offline caching is deliberately not enabled for timekeeping. The app explains why location permission is requested and asks only at punch time. Denied or unavailable GPS still records a provisional punch for manager review. Poor readings trigger a fresh one-shot reading; persistent poor accuracy is flagged rather than treated as proof of being outside. Reliable outside readings require tapping Submit provisional punch; until then, no punch is added. Uncompleted attempts remain visible to managers. Precise employee coordinates are not retained.

## Shared-device kiosk setup

Sign in as an administrator on the warehouse tablet/computer, go to Settings, and choose Enable kiosk on this device. Enter a device name and register it. This issues a random 256-bit HttpOnly device cookie for 30 days, stores only its hash on the server, invalidates the administrator session, and opens the employee screen without management navigation. Register multiple devices as needed. Settings lists every registered device; management can revoke any device immediately, with an audit entry. Re-enroll after expiry or cleared browser cookies. Legacy signed kiosk cookies from the original release no longer grant trust.

Use OS-level single-app mode (iPad Guided Access, Android screen pinning, or a managed browser kiosk policy) to restrict navigation. The website alone cannot lock the operating system or prevent manual navigation to `/admin`; that route still requires separate administrator credentials. Do not save manager passwords in a shared browser. To manage again, leave OS kiosk mode, navigate to `/admin`, and sign in. Remove enrollment in Settings if repurposing the device.

## Backups and recovery

Enable the managed database provider's daily snapshots/PITR and choose retention suitable for your payroll-record policy. Verify the dashboard shows successful backups. Store weekly XLSX exports in restricted payroll storage as an additional review artifact, not a substitute for database backups.

An independent logical backup script is supplied. Install PostgreSQL client tools matching your server, set DATABASE_URL and BACKUP_DIRECTORY (a restricted encrypted backup destination), and schedule the following command daily through your host's scheduler or an existing secure backup system:

```sh
npm run backup
```

It creates a private-permissions custom-format archive and checks that `pg_restore --list` can read it. Transfer it off the database host; monitor failures and configure retention. The script does not automatically register a schedule or delete old backups.

For a restore drill, create an empty separate PostgreSQL database, then run:

```sh
pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" /secure/path/hamilton-backup.dump
```

Point a separate restricted instance at that database, confirm employee/punch/correction counts and a known weekly export, then destroy the drill instance. Do not test restoration against the live database. Keep APP_SECRET backed up separately in a secrets manager. Test restores periodically and before relying on a new backup provider.

## Tests and verification

```sh
npm test
npm run build
```

Tests run against an isolated in-memory PostgreSQL-compatible PGlite engine; they do not connect to production or insert real employee data. Coverage includes normal days, multiple lunches, invalid/duplicate sequences, overnight/week crossings, 40-hour overtime, missing punches, spring/fall DST, API authorization, Origin rejection, rate limiting, separate administrators, simultaneous duplicate/different employee punches, PIN hashing/reset, employee deactivation, kiosk registration/revocation, server geofence validation, GPS permission denial, poor-accuracy retries, outside provisional submission, stale/future readings, forged client validation flags, replay-safe provisional submission, location decision audits, migration repeatability, immutable originals/audited corrections, and real XLSX parsing.

The API integration tests require permission to bind a local HTTP test server. For final deployment acceptance, repeat concurrent punch tests against your managed PostgreSQL instance using development records in a separate staging database. Real PostgreSQL row locks are implemented; the embedded integration harness serializes its single connection and does not prove multi-instance lock behavior by itself.

Browser interaction testing and real mobile GPS permission checks must be completed on deployment; no browser automation runtime is supplied in this workspace. Check tablet/phone layout, five-second privacy reset, Safari/Chrome home-screen installation, location allowed/denied, kiosk restrictions, and actual provider TLS/proxy configuration before staff rollout.

## Source map

- `src/main.tsx`, `src/style.css`: responsive employee and manager UI.
- `server/app.ts`: protected API, time punches, employee administration, corrections, exports.
- `server/time.ts`: DST-safe interval allocation and weekly calculations.
- `server/security.ts`: Argon2id, PIN HMAC, sessions helpers, rate limits, ephemeral geofence checks.
- `server/schema.sql`: original PostgreSQL schema; `migrations/002-location.sql`: additive location/device/review migration.
- `server/location.ts`: server geofence punch workflow, registered devices, provisional attempts and audited reviews.
- `src/location.ts`: one-shot browser GPS permission request; no continuous tracking.
- `scripts/setup.ts`: repeatable schema setup and secure administrator creation/recovery.
- `tests/`: payroll and API tests; `scripts/backup.sh`: backup procedure.

Schema setup now tracks applied versions in `schema_migrations` and runs each migration transactionally under an advisory lock. Add a new versioned migration for later schema changes; do not edit migrations already applied in production. Keep the package lock, upgrade dependencies regularly, and run tests/build before deploying changes.
