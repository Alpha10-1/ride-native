# RIDE — Native Apps

The mobile apps for **RIDE**, a ride-hailing platform: a **Ride** app for
riders and a **Ride Driver** app for drivers. Built with Expo Router and React
Native, backed by one shared Supabase project (Postgres + Edge Functions),
with payments handled through Paystack.

Both apps use the same accounts. Someone who rides and drives signs in to
each app with the same username; opening an app switches their account to
that side (see [How the two apps share an account](#how-the-two-apps-share-an-account)).

A companion web admin panel lives in a separate repo:
[`admin-dashboard`](https://github.com/Alpha10-1/admin-dashboard). It needs
no changes for the split.

---

## Features

**Ride (rider app)**
- Request rides with live map tracking, saved places, and scheduled rides
- Wallet top-ups and card payments via Paystack, plus cash payments
- Trip history, spending reports (PDF export), and in-ride chat
- Safety tools (SOS), promotions, and push notifications
- "Become a driver" opens Ride Driver (or its store listing)

**Ride Driver (driver app)**
- Sign up as a driver, or sign in with an existing rider account and
  register (licence, vehicle, then document verification)
- Go online/offline, receive and accept ride requests, manage active trips
- Earnings, weekly statements (PDF export), payout method management
- Subscription management, ratings, and driver-side support chat

**Shared**
- Supabase Auth (username + password) with suspension/staff checks
- Test-mode support for QA without live payment/subscription gating
- what3words location lookup for precise pickup pins

---

## Tech stack

| Layer | Technology |
|---|---|
| App framework | [Expo](https://expo.dev) SDK 54 + [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing) |
| UI | React Native 0.81, React 19 |
| Maps | `react-native-maps` (Google Maps) |
| Backend | [Supabase](https://supabase.com) (Postgres, Auth, Edge Functions, Storage) |
| Payments | [Paystack](https://paystack.com) |
| Repo | npm workspaces monorepo |
| Language | TypeScript |

---

## Project structure

```
apps/
  rider/                 # Ride — rider app (Expo project)
    app/(rider)/         #   rider screens
    app/auth/, _layout   #   thin re-exports of shared screens
    app.json             #   identity + extra.appRole = "rider"
  driver/                # Ride Driver — driver app (Expo project)
    app/(driver)/        #   driver screens
    app/driver-registration.tsx
    app.json             #   identity + extra.appRole = "driver"
packages/
  shared/                # @ride/shared — used by both apps as TS source
    lib/                 #   Supabase client, rides, payments, push, app mode...
    components/          #   UI components (incl. ModeGate)
    screens/             #   screens used by both apps (auth, profile, wallet...)
    hooks/, theme/, types/
supabase/
  config.toml            # Edge Function deploy settings only (verify_jwt)
  functions/             # Edge Functions (Paystack, push, admin, what3words)
  migrations/            # SQL migrations (applied in timestamp order)
  tests/                 # SQL scenario tests (run against a local Postgres)
loadtest/                # Scripts for load-testing ride requests
```

Shared code imports as `@ride/shared/lib/rides`, `@ride/shared/components/Screen`
and so on. It has no build step: Metro and TypeScript read the source directly,
and its runtime dependencies come from the apps (hoisted to the root
`node_modules`). Add a native dependency to **both** apps' `package.json`
at the same version, or autolinking and hoisting can diverge.

Shared code that behaves differently per app reads `APP_ROLE` / `appRoute()`
from `packages/shared/lib/appConfig.ts`, which comes from each app's
`app.json` → `expo.extra.appRole`. Don't branch on `profiles.role` — it only
records how an account first signed up.

> **Route groups:** `(rider)` and `(driver)` are Expo Router route groups and
> must keep their literal parenthesised folder names. Each app contains only
> its own group, so a route like `/(driver)/requests` doesn't exist in the
> rider app.

---

## Getting started

### Prerequisites
- Node.js (LTS) and npm
- A Supabase project (URL + anon key)
- A Paystack account (test keys for development)
- Google Maps API keys for iOS and Android

### Installation

```bash
git clone https://github.com/Alpha10-1/ride-native.git
cd ride-native
npm install            # installs every workspace from the repo root
```

Always run `npm install` from the repo root, not inside an app folder.

### Environment

Each app reads its own `.env` (Expo only looks next to the app's `app.json`),
and both need the same three values:

```bash
cp apps/rider/.env.example  apps/rider/.env
cp apps/driver/.env.example apps/driver/.env
# fill in the same values in both:
#   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
#   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY   (Directions/Geocoding/Places requests in
#                                      packages/shared/lib/rides.ts, geocoding.ts
#                                      and the rider home screen's place search)
```

Without the Supabase values the app crashes on launch.

`.env` is gitignored, so EAS Build never uploads it. EAS builds read the same
three values from EAS environment variables instead, and they must exist on
**both** EAS projects. Run these inside each app folder (`preview` builds use
the `preview` environment, `production` builds use `production`):

```bash
cd apps/rider   # then again in apps/driver
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value <url> \
  --environment preview --environment production --visibility plaintext
# ...and the same for EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
# (older eas-cli versions call this env:create, with the same flags)
npx eas-cli env:list --environment production
```

Google Maps keys for the native map SDKs are in each app's `app.json`
(`ios.config.googleMapsApiKey`, `android.config.googleMaps.apiKey`). The
Android key is the same in both apps, so its Android-app restriction in
Google Cloud must allow both `com.alpha_lubisi.ridenative` and
`com.alpha_lubisi.ridedriver`, each with the SHA-1 of every certificate that
signs it (the EAS keystore, shown by `npx eas-cli credentials`, and Play's
app-signing key). The `.env` key's web-service calls (Directions, Geocoding,
Places) send no app signature, so that key can't carry an Android-app
restriction; give it its own key, restricted to those APIs.

### Run the apps

```bash
npm run rider             # Expo dev server for Ride
npm run driver            # Expo dev server for Ride Driver
npm run rider:android     # native build + run (also :ios, driver:android, driver:ios)
```

Push notifications, maps and background behavior need a native build
(`expo run:*` or an EAS `preview` build, see
[Building & submitting](#building--submitting)), not Expo Go.

### Type checking

```bash
npm run typecheck         # both apps (each also checks packages/shared)
```

---

## How the two apps share an account

The server still uses `profiles.active_mode` to decide whether someone is
driving: dispatch only sends ride requests to accounts in driver mode, and
notifications for one side are held back while the account is on the other.
In the single app this changed when the user tapped *Switch to Rider/Driver*.
Now **opening an app is the switch**: each app claims its own mode on launch
and whenever it returns to the foreground (`packages/shared/lib/appMode.ts`).

Two guards make that safe for people who both ride and drive. Neither app
switches while a trip is in progress on the other side. The rider app asks
before taking an online driver offline. In both cases `ModeGate` covers the
screen and explains what's happening.

Push tokens are stored **per app** (`rider_push_token`, `driver_push_token`),
so ride requests always reach Ride Driver and trip updates always reach Ride,
whichever app was opened last. See
`supabase/migrations/20261006120000_split_apps_push_tokens.sql`.

---

## Backend (Supabase)

Link the CLI to the hosted project once per machine. The link state lives in
`supabase/.temp/`, a local CLI cache that isn't committed:

```bash
npx supabase login
npx supabase link --project-ref sskqcenwngyryxjfpgnj
```

Migrations live in `supabase/migrations/` and are applied in timestamp order.
The base migrations (`0001`–`0016`, see below) exist only on the hosted
project, so compare local and remote history before pushing:

```bash
npx supabase migration list
npx supabase db push
```

If `db push` aborts because the remote has versions that aren't in the repo,
run the new migration file in the dashboard's SQL editor instead, then
record it as applied (and do the same for any older repo migration that
`migration list` shows as local-only but was already applied by hand, or
`db push` will re-run it):

```bash
npx supabase migration repair --status applied <version>   # e.g. 20261006120000
```

Edge Functions live in `supabase/functions/` and are deployed individually.
`send-push`, `paystack-webhook` and `paystack-charge-recurring` are called
without a Supabase JWT (by pg_net, by Paystack and by the daily cron job) and
check their own secret instead, so they must be deployed with JWT
verification off. Otherwise Supabase rejects every call with 401 and push
notifications and billing silently stop. `supabase/config.toml` sets
`verify_jwt = false` for those three, so a plain deploy picks it up; the
explicit flag works too:

```bash
npx supabase functions deploy <function-name>              # reads supabase/config.toml
npx supabase functions deploy send-push --no-verify-jwt
npx supabase functions deploy paystack-webhook --no-verify-jwt
npx supabase functions deploy paystack-charge-recurring --no-verify-jwt
```

Add `--use-api` to bundle on Supabase's servers if Docker isn't installed.
Never run `supabase config push`: `config.toml` only declares function
settings, and some CLI versions fill every other section with local-dev
defaults and push those over the live project's auth/API settings.

Edge Function secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are provided automatically):

```bash
npx supabase secrets set FUNCTION_SECRET=<long random string>  # send-push, paystack-charge-recurring; must equal push_config.function_secret
npx supabase secrets set CRON_SECRET=<long random string>      # paystack-charge-recurring; must match the cron job's Bearer header
npx supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx       # every paystack-* function
npx supabase secrets set W3W_API_KEY=<what3words key>          # what3words-convert
npx supabase secrets list
```

Key functions include Paystack initialization/charge/webhook flows for
top-ups, ride checkout, card verification, and subscriptions; a push
notification sender; an admin account-creation function; and a what3words
address lookup.

**Auth redirect URLs.** Password-reset and email-confirmation links open the
app they were requested from, so Supabase → Authentication → URL
Configuration → Redirect URLs must allow both `ridenative://**` and
`ridedriver://**`.

> The base schema (migrations `0001`–`0016`: profiles, rides, the original
> push and presence triggers, etc.) was applied to the hosted project but
> isn't in this repo. Export it with `npx supabase db dump --schema public`
> and commit it so the backend can be rebuilt from source.

### Tests

```bash
PGUSER=postgres ./supabase/tests/split-apps-push-tokens/run.sh
```

Applies the notification migrations to a **throwaway local** Postgres
database (never the Supabase project) and checks which app each push
reaches: ride requests, trip updates, announcements, sign-out, shared phones,
and accounts still on the pre-split app.

It needs bash, the PostgreSQL client tools (`psql`, `createdb`, `dropdb`) on
`PATH`, and a local Postgres server to connect to (set `PGHOST`/`PGPASSWORD`
as needed). On Windows, run it from Git Bash with PostgreSQL's `bin` folder on
`PATH`.

---

## Building & submitting

Each app is its own EAS project and store listing. `eas-cli` isn't a repo
dependency, so use `npx eas-cli <command>` (or install it globally and drop
the `npx`), and always run it from inside the app's folder:

```bash
cd apps/rider   # or apps/driver
npx eas-cli login                                          # once per machine
npx eas-cli build --profile preview --platform android     # installable APK
npx eas-cli build --profile production --platform android  # AAB for Google Play
npx eas-cli build --profile production --platform ios
npx eas-cli submit --platform android
npx eas-cli submit --platform ios
```

`preview` builds an APK you can install directly (internal distribution);
`production` builds the AAB that Play needs. The `development` profile needs
`expo-dev-client`, which isn't installed, so add it to that app before using
the profile.

- **Ride** keeps the original identity (`com.alpha_lubisi.ridenative`, EAS
  project `72eae5ed-…`, scheme `ridenative`), so existing installs update
  straight into the rider app.
- **Ride Driver** is new (`com.alpha_lubisi.ridedriver`, scheme `ridedriver`)
  and has its own EAS project, `@alpha_lubisi/ride-driver`
  (`b9864d2f-ae61-490d-8598-ba50e55ed983`). Its project ID is already in
  `apps/driver/app.json`, so there's no `eas init` step. Its push tokens
  belong to that project, not Ride's, which is why `send-push` must split
  them (see [Rolling out the split](#rolling-out-the-split)).

`eas.json` submit configuration needs account-specific credentials (Apple ID
/ Team ID / App Store Connect app ID, and a Google Play service account JSON)
that are not committed to this repo. Once each app has a store listing, put
the other app's App Store URL in `expo.extra.counterpart.iosAppStoreUrl` so
"Open Ride Driver" / "Open Ride" can send iOS users to install it.

### Rolling out the split

Existing users all have the pre-split app, which becomes the rider app when
it updates. To avoid drivers losing ride requests in between:

1. Deploy the updated `send-push` (JWT verification off, see
   [Backend](#backend-supabase)), then apply
   `20261006120000_split_apps_push_tokens.sql`. Both must be live **before
   any Ride Driver build reaches users**, internal APKs included. Ride
   Driver's push tokens belong to a different Expo project, and Expo rejects
   a batch that mixes projects as a whole, so nobody in it gets the push.
   `send-push` now splits each send per Expo project and into chunks of 100.
2. Deploy the updated `paystack-charge-recurring` function (after the
   migration, since it reads the new token columns).
3. Add `ridedriver://**` to Supabase → Authentication → URL Configuration →
   Redirect URLs.
4. Set up Firebase Cloud Messaging for `com.alpha_lubisi.ridedriver`: add the
   Android app in Firebase, point `android.googleServicesFile` in
   `apps/driver/app.json` at its `google-services.json`, and upload the FCM V1
   service-account key to the `ride-driver` EAS project
   (`npx eas-cli credentials`). Without it, Android builds get no push token.
5. Publish **Ride Driver** to both stores, and tell drivers to install it.
6. Release the **Ride** update last.

Until someone installs one of the new apps, their account keeps working
exactly as before on the old app.

---

## Known limitations

- **Web is not a supported target for production.** `react-native-maps` has
  no web implementation, so map-dependent screens will not function via
  `expo start --web`.
- Paystack **Preauthorization** (used for card-based ride reservations) is
  gated behind Paystack's approval for South African merchants; the app
  degrades gracefully to standard charge flows until that's approved.
- Driver location only refreshes while Ride Driver is in the foreground, and
  dispatch ignores locations older than 15 minutes. Background location is
  not implemented yet.

---

## License

Proprietary — all rights reserved.
