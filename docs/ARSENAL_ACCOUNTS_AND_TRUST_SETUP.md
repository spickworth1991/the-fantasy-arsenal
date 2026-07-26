# Arsenal accounts, cloud sync, avatars, and Trust Center setup

Accounts are optional. Guest users retain full access and keep their data in the browser. An Arsenal account adds username/password sign-in and synchronizes only durable user data: profile preferences, source/format choices, Intelligence actions, watchlists, draft queues, saved lineups, playoff scenarios, trade workspaces, and commissioner notes. League/API caches are deliberately excluded.

## Cloudflare Dashboard setup — no PowerShell required

Use this path if you want to configure everything in the Cloudflare website.

### A. Create the account database

1. Sign in at `dash.cloudflare.com`.
2. In the left sidebar, open **Storage & Databases → D1 SQL Database**.
3. Select **Create database**.
4. Name it `tfa_arsenal`.
5. Open the new database.
6. Open its **Console** tab.
7. On your computer, open `cloudflare/arsenal-schema.sql` from this project.
8. Copy the entire SQL file, paste it into the Cloudflare D1 Console, and select **Execute**.
9. Open the database’s **Tables** view and verify these tables exist:
   - `arsenal_accounts`
   - `arsenal_sessions`
   - `arsenal_sync_items`

If you are reusing the older database that already contains `arsenal_accounts`, paste and execute `cloudflare/arsenal-existing-db-migration.sql` instead. Run that migration only once. A duplicate-column error means those columns were already added and should not be added again.

If the account/login migration was already installed before premium profiles and the manager leaderboard were added, run only `cloudflare/arsenal-profile-migration.sql` once. It adds favorite-team, public-profile/privacy, and verified-record fields without recreating any account tables.

If premium profiles were already installed before career résumés and achievements were added, run only `cloudflare/arsenal-career-migration.sql` once. Do not rerun the larger profile migration.

### B. Create private avatar storage

1. In Cloudflare, open **Storage & Databases → R2 Object Storage**.
2. Select **Create bucket**.
3. Name the bucket `tfa-profile-media`.
4. Leave the bucket private. Do not create a public development URL or custom domain.

### C. Connect both resources to the site

1. Open **Workers & Pages**.
2. Select the Pages project for The Fantasy Arsenal.
3. Open **Settings → Functions → Bindings**. In newer Cloudflare layouts this may appear under **Settings → Runtime → Bindings**.
4. Select **Add binding → D1 database**.
5. Enter:
   - Variable name: `ARSENAL_DB`
   - Database: `tfa_arsenal`
6. Select **Add binding → R2 bucket**.
7. Enter:
   - Variable name: `PROFILE_MEDIA`
   - Bucket: `tfa-profile-media`
8. Save the Production bindings.
9. Switch the environment selector to **Preview** and add the same two bindings there if branch/preview deployments should support accounts.

### D. Redeploy after adding bindings

1. Open the project’s **Deployments** tab.
2. Open the latest production deployment.
3. Choose **Retry deployment**. If Retry is unavailable, push a new commit to the connected GitHub branch.
4. Wait for the new deployment to finish. Bindings are not retroactively attached to an already-built deployment.

### E. Test through the deployed website

1. Visit `/profile` on the deployed domain—not localhost.
2. Sign into Sleeper.
3. Create an Arsenal account.
4. Edit the profile and select a stock avatar.
5. Upload a small PNG or WEBP avatar.
6. Sign out.
7. Open a private browser window or another device.
8. Sign in with the same Arsenal account name and password.
9. Confirm the profile and supported preferences return.

If account creation reports that `ARSENAL_DB` is unavailable, the D1 binding name is missing or was added to the wrong environment. If avatar upload reports that `PROFILE_MEDIA` is unavailable, the R2 binding is missing or the site was not redeployed after adding it.

## 1. Create the Cloudflare D1 database

Recommended: use a dedicated database instead of the push-notification database.

```powershell
npx wrangler login
npx wrangler d1 create tfa_arsenal
npx wrangler d1 execute tfa_arsenal --remote --file cloudflare/arsenal-schema.sql
```

If the existing `PUSH_DB` database already contains the original `arsenal_accounts` table, do not run the full schema against a new database and then migrate it. Run this once against the existing database instead:

```powershell
npx wrangler d1 execute YOUR_EXISTING_D1_DATABASE_NAME --remote --file cloudflare/arsenal-existing-db-migration.sql
```

The application also performs idempotent schema checks at runtime, but applying the SQL first makes deployment errors easier to diagnose.

## 2. Create avatar storage

```powershell
npx wrangler r2 bucket create tfa-profile-media
```

The bucket stays private. Uploaded avatars are served through `/api/arsenal/avatar`; no public bucket URL is required.

## 3. Add Cloudflare Pages bindings

In Cloudflare:

1. Open **Workers & Pages**.
2. Open the Pages project that deploys The Fantasy Arsenal.
3. Open **Settings → Functions → Bindings**.
4. Under **D1 database bindings**, add:
   - Variable name: `ARSENAL_DB`
   - D1 database: `tfa_arsenal`
5. Under **R2 bucket bindings**, add:
   - Variable name: `PROFILE_MEDIA`
   - R2 bucket: `tfa-profile-media`
6. Add the same bindings to both **Production** and **Preview** if preview deployments should support accounts.
7. Save and trigger a new deployment. Bindings are not added to deployments that already exist.

`PUSH_DB` remains a supported database fallback, but `ARSENAL_DB` is preferred so account storage and draft-alert storage can be managed independently.

## 4. Verify the deployment

1. Open `/profile`.
2. Sign into Sleeper.
3. Create an optional Arsenal account with an account name and a password of at least 10 characters.
4. Change the avatar, source, format, one watchlist, and one saved feature.
5. Open a private/incognito browser or another phone.
6. Visit `/profile` and sign in with the same Arsenal credentials.
7. Press **Sync now** once if needed. The profile and durable settings should appear.
8. Upload a small WEBP/PNG avatar. A `503 PROFILE_MEDIA` message means the R2 binding is absent from that deployment environment.

Existing recovery-key accounts can be upgraded without data loss: sign in on a device where the old account is still connected, open `/profile`, and set an account name and password under **Account sign-in**.

## 5. Trust & Accuracy Center data

The Trust Center is available at `/trust-center`. It reads the live value/projection JSON files plus:

- `public/value-cache-version.json`
- `public/archive/index.json`
- dated manifests and compressed snapshots in `public/archive`

Keep the existing daily GitHub workflow enabled:

```powershell
npm run update:daily
```

The workflow archives a dated, frozen copy of every successful value/projection update. Those snapshots are the audit trail required for honest future accuracy scoring. Never delete old archive dates if historical trends and accuracy should remain available.

Projection accuracy is reported only when a pre-kickoff archived forecast can be paired with finalized actual scoring. Season projections are not presented as weekly projections. Win-probability calibration and recommendation performance likewise remain unscored until enough timestamped predictions and resolved outcomes exist.

## 6. Cloudflare limits and privacy

- Passwords are never stored directly. They use salted PBKDF2-SHA256 hashes.
- Each browser receives a separate random session token.
- Uploaded media is limited by the avatar API to supported image types and 1.5 MB.
- A synchronized item is capped at 600,000 characters and each request at 500 items.
- Transient Sleeper responses, league caches, player datasets, and Intelligence fetch caches are not synchronized.
- Signing out removes only the current browser session token. It does not erase cloud data or sign out other devices.
