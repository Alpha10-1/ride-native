# Rider Payments — File Manifest

Route-group folder names (`(rider)`, `(driver)`) don't play well as literal
filesystem paths in a download, so they're flattened to `rider/` and
`driver/` here. Copy each file back to its real path in `ride-native`:

| File in this folder | Real path in ride-native |
|---|---|
| `supabase/migrations/20260802120000_rider_payments.sql` | same path |
| `supabase/functions/paystack-initialize-topup/index.ts` | same path (new) |
| `supabase/functions/paystack-initialize-ride-checkout/index.ts` | same path (new) |
| `supabase/functions/paystack-charge-ride-card/index.ts` | same path (new) |
| `supabase/functions/paystack-webhook/index.ts` | same path (**overwrite existing**) |
| `src/lib/payments.ts` | same path (new) |
| `src/lib/wallet.ts` | same path (**overwrite existing**) |
| `src/lib/rides.ts` | same path (**overwrite existing**) |
| `src/screens/PaymentMethodsScreen.tsx` | same path (new) |
| `src/screens/WalletScreen.tsx` | same path (**overwrite existing**) |
| `src/components/SideMenuDrawer.tsx` | same path (**overwrite existing**) |
| `app/rider/payment-methods.tsx` | `app/(rider)/payment-methods.tsx` (new) |
| `app/rider/home.tsx` | `app/(rider)/home.tsx` (**overwrite existing**) |
| `app/rider/ride-complete.tsx` | `app/(rider)/ride-complete.tsx` (**overwrite existing**) |
| `app/driver/active-trip.tsx` | `app/(driver)/active-trip.tsx` (**overwrite existing**) |
| `app/driver/trip-complete.tsx` | `app/(driver)/trip-complete.tsx` (**overwrite existing**) |

## Deploy steps

1. Apply the migration:
   ```
   supabase db push
   ```
2. Deploy the new + updated Edge Functions:
   ```
   supabase functions deploy paystack-initialize-topup
   supabase functions deploy paystack-initialize-ride-checkout
   supabase functions deploy paystack-charge-ride-card
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```
3. Confirm `PAYSTACK_SECRET_KEY` is already set as a function secret (it
   should be, from the driver subscription work) — no new secrets needed.
4. Rebuild the app (native code didn't change, so a normal `expo start
   --dev-client` reload is enough — no prebuild needed for this feature).

## What this does

- Clears all existing (simulated) wallet balances and transaction history.
- Adds three ways to pay for a ride: **wallet** (pre-loaded balance),
  **card** (charged via Paystack, saved for one-tap next time), and
  **cash** (collected by the driver, nothing processed digitally).
- New **Payment Methods** screen (rider side menu) to set a default and
  manage saved cards.
- Ride request sheet gets a Cash/Wallet/Card picker, defaulting to the
  rider's saved preference.
- Ride completion (driver's `active-trip.tsx` and rider's
  `ride-complete.tsx`) settles the fare automatically — instant for
  cash/wallet, via Paystack for card, with a "Pay by Card" retry button
  if a card charge or wallet debit fails.

This was tested against a local Postgres instance mirroring the real
schema (migration applied cleanly; RLS, authorization boundaries,
idempotency, and concurrent-top-up atomicity all verified directly with
SQL) — see the conversation for the full test transcript. It has **not**
been tested against your actual Supabase project or on-device yet.
