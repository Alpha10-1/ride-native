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

Each app reads its own `.env` (Expo only looks next to the app's `app.json`):

```bash
cp apps/rider/.env.example  apps/rider/.env
cp apps/driver/.env.example apps/driver/.env
# fill in the same Supabase URL/anon key in both
```

Google Maps keys for the native map SDKs are in each app's `app.json`
(`ios.config.googleMapsApiKey`, `android.config.googleMaps.apiKey`).

### Run the apps

```bash
npm run rider             # Expo dev server for Ride
npm run driver            # Expo dev server for Ride Driver
npm run rider:android     # native build + run (also :ios, driver:android, driver:ios)
```

Push notifications, maps and background behavior need a development build
(`expo run:*` or an EAS development build), not Expo Go.

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

Migrations live in `supabase/migrations/` and are applied in timestamp order:

```bash
npx supabase db push
```

Edge Functions live in `supabase/functions/` and are deployed individually:

```bash
npx supabase functions deploy <function-name>
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

---

## Building & submitting

Each app is its own EAS project and store listing. Run EAS commands from
inside the app's folder:

```bash
cd apps/rider   # or apps/driver
eas build --profile production --platform android
eas build --profile production --platform ios
eas submit --platform android
eas submit --platform ios
```

- **Ride** keeps the original identity (`com.alpha_lubisi.ridenative`, EAS
  project `72eae5ed-…`, scheme `ridenative`), so existing installs update
  straight into the rider app.
- **Ride Driver** is new (`com.alpha_lubisi.ridedriver`, scheme `ridedriver`).
  Before its first build, run `npx eas init` in `apps/driver` to create its
  EAS project — without a project ID it can't get push tokens, so it would
  never receive ride requests.

`eas.json` submit configuration needs account-specific credentials (Apple ID
/ Team ID / App Store Connect app ID, and a Google Play service account JSON)
that are not committed to this repo. Once each app has a store listing, put
the other app's App Store URL in `expo.extra.counterpart.iosAppStoreUrl` so
"Open Ride Driver" / "Open Ride" can send iOS users to install it.

### Rolling out the split

Existing users all have the pre-split app, which becomes the rider app when
it updates. To avoid drivers losing ride requests in between:

1. Publish **Ride Driver** to both stores.
2. Apply `20261006120000_split_apps_push_tokens.sql`, then deploy the updated
   `paystack-charge-recurring` function.
3. Add `ridedriver://**` to the Supabase auth redirect allow-list.
4. Tell drivers to install Ride Driver.
5. Release the **Ride** update.

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
