# Verified production deployment

- Employee clock: https://hamilton-wall-systems-clock.onrender.com/
- Initial administrator activation: https://hamilton-wall-systems-clock.onrender.com/setup
- Administrator sign-in: https://hamilton-wall-systems-clock.onrender.com/admin
- Render web service: https://dashboard.render.com/web/srv-dbh0p6utlv9c73dj6bdg
- Render database: https://dashboard.render.com/d/dpg-dbh0oputlv9c73dj5aeg-a

Verified October 28, 2026. Render deployment `dep-dbh0p7etlv9c73dj6bv0` is live, running application source commit `2a91c518642c412b8454dd5ee1335763d122defd`. Later documentation-only commits do not require another application deployment.

The web service and managed PostgreSQL 17 database are in the confirmed My Workspace account in Virginia. The web service uses the 0.5c-512mb compute plan. The database uses 0.1c-256mb, 1 GB storage, and an empty external IP allow list. Credentials and initial setup keys are managed in Render environment variables, never this repository.

## Verified release checks

- Render deployment reached `live` and the database reached `available`.
- Homepage, `/setup`, `/admin`, bundled JavaScript and stylesheet respond successfully over HTTPS.
- The deployed JavaScript includes the Hamilton Wall Systems top-left branding.
- `/api/health` confirms a successful database query.
- `/api/setup-status` reports that the initial administrator activation is available.
- `/api/config` reports required geofencing, Monday workweek start, and America/New_York display.
- Unauthenticated employee administration, Excel payroll export and location reviews reject access with HTTP 401.
- A punch request without the configured same-site origin is rejected with HTTP 403 before recording a punch.
- The application release passed all 42 automated tests before deployment, including first-administrator activation, payroll, location checks, kiosk trust, audited corrections and migrations.

These live checks do not create administrators, sample employees, production punches or other test payroll records. Real-device layout, GPS permission and kiosk checks remain part of warehouse onboarding.

## Activate management access

1. Open the Render web service link above and select **Environment**.
2. Privately reveal/copy `ADMIN_SETUP_TOKEN`. Do not send it in chat or put it in a URL.
3. Open the application `/setup` link. Enter that key, your chosen administrator email, and a unique password of at least 14 characters.
4. Sign in at `/admin`. The setup endpoint disables itself once an administrator exists. Remove the setup key from the Render environment after activation as additional cleanup.
5. Configure the warehouse GPS coordinates and radius in **Settings**. Register each shared warehouse device by name and add real employees.
6. Verify a phone punch, GPS denial/provisional review, kiosk punch and payroll export using an authorized test procedure before employee rollout. Confirm managed database backups/PITR and perform the documented restore drill. No backup restore test was performed against the live database.
