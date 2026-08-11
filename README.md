# RIDE — Native App

The rider/driver mobile app for **RIDE**, a ride-hailing platform. Built with
Expo Router and React Native, backed by Supabase (Postgres + Edge Functions),
with payments handled through Paystack.

This app supports a single user account switching between **rider** and
**driver** modes (dual-role), rather than separate apps per role.

A companion web admin panel lives in a separate repo:
[`admin-dashboard`](https://github.com/Alpha10-1/admin-dashboard).

---

## Features

**Rider**
- Request rides with live map tracking, saved places, and scheduled rides
- Wallet top-ups and card payments via Paystack, plus cash payments
- Trip history, spending reports (PDF export), and in-ride chat
- Safety tools (SOS), promotions, and push notifications

**Driver**
- Apply/verify to drive directly from the rider account (dual-role Apply flow)
- Go online/offline, accept ride requests, manage active trips
- Earnings, weekly statements (PDF export), payout method management
- Subscription management, ratings, and driver-side support chat

**Shared**
- Supabase Auth (email/phone) with role-aware routing
- Test-mode support for QA without live payment/subscription gating
- what3words location lookup for precise pickup pins

---

## Tech stack

| Layer | Technology |
|---|---|
| App framework | [Expo](https://expo.dev) + [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing) |
| UI | React Native 0.81, React 19 |
| Maps | `react-native-maps` (Google Maps), Huawei HMS Map/Location for HMS devices |
| Backend | [Supabase](https://supabase.com) (Postgres, Auth, Edge Functions, Storage) |
| Payments | [Paystack](https://paystack.com) |
| Language | TypeScript |

---

## Project structure

```
app/
  (rider)/          # Rider-only screens (route group)
  (driver)/          # Driver-only screens (route group)
  (tabs)/            # Shared bottom-tab entry points
  auth/               # Login, signup, password/username recovery
  _layout.tsx         # Root layout / role-aware routing
  index.tsx           # App entry
src/
  components/         # Shared UI components
  screens/             # Screen implementations used by app/ routes
  lib/                 # Supabase client, payments, rides, notifications, etc.
  hooks/               # Shared React hooks
  theme/               # Design tokens
supabase/
  functions/           # Edge Functions (Paystack, push notifications, admin, what3words)
  migrations/           # SQL migrations (applied in timestamp order)
plugins/               # Custom Expo config plugins (e.g. HMS Core)
loadtest/               # Scripts for load-testing ride requests
```

> **Note on route groups:** `(rider)` and `(driver)` are Expo Router route
> groups and must remain literal folder names with parentheses. Code should
> never be placed in plain `app/rider/` or `app/driver/` folders — those are
> not recognized by the router and will silently fail to route correctly.

---

## Getting started

### Prerequisites
- Node.js (LTS) and npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (via `npx expo`)
- A Supabase project (URL + anon key)
- A Paystack account (test keys for development)
- Google Maps API keys for iOS and Android

### Installation

```bash
git clone https://github.com/Alpha10-1/ride-native.git
cd ride-native
npm install
```

### Environment / configuration

Update `app.json` with your own Google Maps API keys under `ios.config.googleMapsApiKey`
and `android.config.googleMaps.apiKey`, and confirm the `ios.bundleIdentifier` /
`android.package` values match your Apple/Google developer accounts.

Supabase and Paystack credentials are configured via Supabase project secrets
(for Edge Functions) and the Supabase client in `src/lib/supabase.ts` — set
your project URL and anon key there or via your preferred env strategy.

### Run the app

```bash
npm start          # Expo dev server (scan QR with Expo Go, or open a simulator)
npm run ios        # Run on iOS simulator
npm run android     # Run on Android emulator
npm run web         # Run in a browser (limited — see Known limitations)
```

### Type checking

```bash
npx tsc --noEmit
```

---

## Backend (Supabase)

Migrations live in `supabase/migrations/` and are applied in timestamp order:

```bash
supabase db push
```

Edge Functions live in `supabase/functions/` and are deployed individually:

```bash
supabase functions deploy <function-name>
```

Key functions include Paystack initialization/charge/webhook flows for
top-ups, ride checkout, card verification, and subscriptions; a push
notification sender; an admin account-creation function; and a what3words
address lookup.

---

## Building & submitting

Builds and store submissions are managed with [EAS](https://expo.dev/eas):

```bash
eas build --profile production --platform ios
eas build --profile production --platform android
eas submit --platform ios
eas submit --platform android
```

`eas.json` submit configuration requires account-specific credentials
(Apple ID / Team ID / App Store Connect app ID, and a Google Play service
account JSON) that are not committed to this repo.

---

## Known limitations

- **Web is not a supported target for production.** `react-native-maps` has
  no web implementation, so map-dependent screens will not function via
  `expo start --web` / `npm run web`.
- Paystack **Preauthorization** (used for card-based ride reservations) is
  gated behind Paystack's approval for South African merchants; the app
  degrades gracefully to standard charge flows until that's approved.

---

## License

Proprietary — all rights reserved.
