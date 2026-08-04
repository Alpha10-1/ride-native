# Ride-Native Updates — Deployment & Verification Guide

Everything from this session: dual-role driver Apply flow, and the full
10-item feedback list (auth fixes, profile photos, branded statements,
payments/banking, driver notifications, support chat, the back-button
bug, and rider spending reports).

Route-group folders (`(rider)`, `(driver)`) don't survive as literal
filesystem paths in a download, so they're flattened here to `rider/`,
`driver/`, `auth/`, and `root/` (top-level `app/*.tsx` files). **Copy each
file back to its real path** per the manifest below — most are
overwrites of existing files, a handful are new.

---

## 1. File manifest

### Database (apply in this exact order — the timestamps already sort correctly)
| File | Real path |
|---|---|
| `supabase/migrations/20260802120000_rider_payments.sql` | same path |
| `supabase/migrations/20260803120000_dual_role_driver_apply.sql` | same path |
| `supabase/migrations/20260803130000_avatars.sql` | same path |
| `supabase/migrations/20260803140000_rider_banking_details.sql` | same path |
| `supabase/migrations/20260803150000_driver_notifications.sql` | same path |
| `supabase/migrations/20260803160000_rider_spending_report.sql` | same path |

### Edge Functions
| File | Real path | New or overwrite? |
|---|---|---|
| `supabase/functions/paystack-initialize-topup/index.ts` | same | new |
| `supabase/functions/paystack-initialize-ride-checkout/index.ts` | same | new |
| `supabase/functions/paystack-charge-ride-card/index.ts` | same | new |
| `supabase/functions/what3words-convert/index.ts` | same | new |
| `supabase/functions/paystack-webhook/index.ts` | same | **overwrite** |
| `supabase/functions/paystack-charge-recurring/index.ts` | same | **overwrite** |

### App code
| File in this folder | Real path | New or overwrite? |
|---|---|---|
| `app/rider/home.tsx` | `app/(rider)/home.tsx` | overwrite |
| `app/rider/ride-complete.tsx` | `app/(rider)/ride-complete.tsx` | overwrite |
| `app/rider/ride-tracking.tsx` | `app/(rider)/ride-tracking.tsx` | overwrite |
| `app/rider/saved-place-picker.tsx` | `app/(rider)/saved-place-picker.tsx` | overwrite |
| `app/rider/settings.tsx` | `app/(rider)/settings.tsx` | overwrite |
| `app/rider/payment-methods.tsx` | `app/(rider)/payment-methods.tsx` | new |
| `app/rider/spending-report.tsx` | `app/(rider)/spending-report.tsx` | new |
| `app/driver/home.tsx` | `app/(driver)/home.tsx` | overwrite |
| `app/driver/active-trip.tsx` | `app/(driver)/active-trip.tsx` | overwrite |
| `app/driver/trip-complete.tsx` | `app/(driver)/trip-complete.tsx` | overwrite |
| `app/driver/settings.tsx` | `app/(driver)/settings.tsx` | overwrite |
| `app/driver/statements.tsx` | `app/(driver)/statements.tsx` | overwrite |
| `app/auth/forgot-username.tsx` | `app/auth/forgot-username.tsx` | overwrite |
| `app/auth/reset-password.tsx` | `app/auth/reset-password.tsx` | overwrite |
| `app/root/_layout.tsx` | `app/_layout.tsx` | overwrite |
| `app/root/driver-registration.tsx` | `app/driver-registration.tsx` | new |
| `src/lib/*.ts` (11 files) | `src/lib/*.ts` | mix — `driverApplication.ts`, `navigation.ts`, `payments.ts`, `pdfBranding.ts`, `spendingReport.ts`, `what3words.ts` are **new**; `auth.ts`, `presence.ts`, `rides.ts`, `statements.ts`, `wallet.ts` are **overwrites** |
| `src/screens/*.tsx` (11 files) | `src/screens/*.tsx` | `PaymentMethodsScreen.tsx`, `SpendingReportScreen.tsx` are **new**; the other 9 are **overwrites** |
| `src/components/SideMenuDrawer.tsx` | same | overwrite |
| `src/components/SupportChatFab.tsx` | same | new |

**Not included:** `package-lock.json` — no new npm packages were actually
added (only new source files + DB/edge-function changes), so your own
lockfile is fine as-is.

---

## 2. Deploy steps, in order

```bash
# 1. Database — applies all 6 new migrations
supabase db push

# 2. Edge Functions
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy paystack-charge-recurring
supabase functions deploy paystack-initialize-topup
supabase functions deploy paystack-initialize-ride-checkout
supabase functions deploy paystack-charge-ride-card
supabase functions deploy what3words-convert
```

### Secrets
```bash
# Should already be set from earlier work — no change needed:
#   PAYSTACK_SECRET_KEY

# New — required for the what3words search-box detection + pin tagging:
supabase secrets set W3W_API_KEY=xxxxxxx
```
Get a key at https://what3words.com/select-plan — check their free-tier
request cap against your expected volume before relying on it in
production.

### One-time manual DB setup for driver notifications (item 5)
The new-ride-request / ride-update / payment / announcement pushes all
route through `pg_net` + a `push_config` table that **already existed**
in your project before this session (used by the pre-existing
`send-push` function) — this session's migration only adds triggers on
top of it. Confirm both of these are actually set, or every trigger will
silently no-op (by design — a push failing to send must never be able
to block a ride):

```sql
-- Check pg_net is enabled:
create extension if not exists pg_net;

-- Check these are populated (per send-push's own deploy notes):
select * from public.push_config;
-- should show two rows: 'function_url' and 'function_secret',
-- matching the FUNCTION_SECRET you set for send-push.
```

If `push_config` is empty, that's a pre-existing gap unrelated to this
session's changes — set it per `supabase/functions/send-push/index.ts`'s
own header comment.

### Storage
The avatars migration creates the `avatars` bucket automatically
(`insert into storage.buckets ...`) — no manual dashboard step needed.

---

## 3. What's genuinely new vs. what's now finally wired up

A few of the ten feedback items turned out to be **real bugs** in
already-existing code, not missing features:
- Password reset only handled the cold-start deep link — fixed to also
  handle the app already being open (`Linking.addEventListener`).
- Forgot Username had a literal TypeScript error (invalid `keyboardType`
  value) that would have been silently wrong at runtime.
- The driver's "Log out" button never actually called `signOut()` — it
  just navigated to the login screen while the session stayed alive.
- The back-button bug: `router.replace()` in Expo Router only swaps the
  *current* screen, it doesn't clear stack history underneath — so any
  cross-portal or sign-out transition left old screens reachable via
  back. Fixed everywhere via a new `resetTo()` helper.
- Payment Methods was only reachable via the side-menu drawer, never
  from Settings — added there too.

Everything else (avatars, banking details, driver notifications,
support chat FAB, spending reports, dual-role Apply flow) is net-new.

---

## 4. Manual QA checklist

Test against a real device/emulator with the migrations + functions
actually deployed — none of this was tested on-device from my sandbox,
only against local Postgres (DB logic) and `tsc` (type safety). Postgres
testing covered: RLS boundaries, RPC validation errors, idempotency,
concurrent-write atomicity, and (for the notification triggers) exact
nearby-driver matching/exclusion using a scripted `pg_net` stub — but
none of it touched a real device, a real Paystack sandbox charge, or a
real Expo push token.

**Auth**
- [ ] Request a password reset, tap the email link with the app closed → lands on reset screen
- [ ] Request a password reset, tap the email link with the app open in background → also lands on reset screen (this was the broken case)
- [ ] Forgot Username flow end-to-end with a real phone number OTP

**Profile photos**
- [ ] Upload a photo as a rider, confirm it persists after app restart
- [ ] Upload a photo as a driver, confirm it persists
- [ ] Re-upload to replace an existing photo, confirm the old one doesn't linger (cache-busted URL)

**Driver statements**
- [ ] Export a weekly statement with trips, check the PDF renders the RIDE wordmark, ref number, vehicle info, and totals correctly
- [ ] Export a statement with zero trips in the period, confirm it doesn't crash and shows an empty-state row

**Payments & banking**
- [ ] Top up a wallet with a real Paystack test card, confirm balance updates
- [ ] Request a ride paying by card (no saved card yet) → checkout flow → card gets saved for next time
- [ ] Request a ride paying by card again → one-tap charge using the saved card, no checkout needed
- [ ] Request a ride paying cash → settles instantly on completion, no Paystack involved
- [ ] Add/update/remove banking details (holder, bank, account number, branch code) from Payment Methods
- [ ] Confirm Payment Methods is now reachable from Settings, not just the side menu

**Driver notifications**
- [ ] With one driver online nearby and one online 20km+ away, request a ride — only the near one gets a push
- [ ] Go offline, confirm no new-ride-request push arrives
- [ ] As a dual-role driver currently switched to rider mode, confirm no driver pushes arrive
- [ ] Complete a card-paid ride, confirm the driver gets a "Payment received" push once it settles
- [ ] Have a rider cancel an in-progress ride, confirm the driver gets a "Trip cancelled" push
- [ ] Insert a test row into `public.announcements` (audience 'drivers'/'riders'/'all') and confirm the right group gets pushed

**Support chat**
- [ ] Tap the floating chat button from both home screens and both active-trip/tracking screens, confirm it opens the right role's support chat
- [ ] Confirm it doesn't visually overlap the bottom action panel on active-trip/tracking

**Back-button bug (the big one)**
- [ ] As a plain rider, repeatedly tap "Book a Ride" in the side menu, then repeatedly press back — should never leave rider screens
- [ ] Register as a driver from the Apply banner, use several driver screens, switch to rider mode, then press back repeatedly — should never resurface a driver screen
- [ ] Sign out from deep within the app (e.g. from a settings sub-screen), then press back — should land nowhere except the login screen

**Rider spending reports**
- [ ] Export a weekly and a monthly report, confirm trip dates/amounts/payment methods are correct and match Trip History
- [ ] Export with zero trips in the period, confirm it doesn't crash

**Dual-role Apply flow (carried over from the prior session, re-verify with this batch deployed)**
- [ ] Rider taps Apply with no driver info on file → goes straight into registration, not a dead-end
- [ ] Submits registration → lands in document verification immediately, already in driver mode
- [ ] Already-registered driver taps "Switch to Driver" → skips registration, goes straight online-ready

---

## 5. Known gaps / things I couldn't verify from this sandbox

- **Nothing here was tested against your actual Supabase project** — no
  network access to it from where I was working. All SQL was verified
  against a local Postgres instance with a scripted `pg_net` stub, which
  proves the *logic* is correct but can't prove the real extension,
  your real `push_config` values, or real Expo push delivery work.
- **what3words** — no network access to `api.what3words.com` either;
  the regex detection and request/response shapes are solid and
  type-check clean, but a real end-to-end lookup hasn't been exercised.
- **Announcements** — there's no admin UI in this codebase to create
  them from yet; for now they're created by inserting directly into
  `public.announcements` (SQL editor or any future admin tool).
