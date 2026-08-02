// Load test: simulates a burst of simultaneous ride requests, plus a
// separate scenario that checks whether accept_ride correctly prevents
// two drivers from being assigned the same ride when they tap "Accept"
// at almost the same moment.
//
// SETUP (do this against a STAGING project — never production/live keys):
//   1. Seed N test rider accounts and N test driver accounts (see
//      scripts/seed-load-test-users.md below) — do NOT reuse real users.
//   2. Export env vars:
//        export SUPABASE_URL="https://<staging-project-ref>.supabase.co"
//        export SUPABASE_ANON_KEY="<staging anon key>"
//   3. Install k6: https://k6.io/docs/get-started/installation/
//
// RUN — burst of 1000 simultaneous ride requests:
//   k6 run --vus 1000 --iterations 1000 loadtest/ride-request-burst.js
//
// RUN — a steadier ramp instead of an instant spike (often more realistic
// for "New Year's Eve" style demand than everyone hitting at t=0):
//   k6 run --stage 30s:1000 --stage 1m:1000 --stage 10s:0 loadtest/ride-request-burst.js
//
// RUN — the accept-race scenario specifically:
//   k6 run --scenario acceptRace loadtest/ride-request-burst.js
//
// WHAT TO WATCH:
//   - http_req_duration p95/p99 for the request_ride call — if this
//     climbs past a couple seconds under load, riders will think the app
//     is frozen.
//   - http_req_failed rate — any non-2xx here under load is a real bug,
//     not "expected" backpressure (Supabase should queue/pool, not 500).
//   - In Supabase's dashboard during the run: Postgres connection count,
//     CPU, and Realtime concurrent connections.
//   - In the accept-race scenario: query driver_subscriptions... no —
//     query the rides table afterwards and confirm every contested ride
//     has exactly ONE accepted driver, never two, never a stuck 'pending'
//     that should have resolved.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;

const rideRequestErrors = new Counter("ride_request_errors");
const acceptRaceDoubleWins = new Counter("accept_race_double_wins");
const rideRequestDuration = new Trend("ride_request_duration_ms");

// Loaded from a JSON file you generate via the seeding script — one
// {username, password} pair per simulated rider/driver so every VU uses
// a distinct real account (never share one login across VUs).
const riders = JSON.parse(open("./riders.json"));
const drivers = JSON.parse(open("./drivers.json"));

function loginAndGetToken(username, password) {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: `${username}@ridenative.internal`, password }),
    { headers: { apikey: ANON_KEY, "Content-Type": "application/json" } }
  );
  check(res, { "login succeeded": (r) => r.status === 200 });
  return res.json("access_token");
}

function authedHeaders(token) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// --- Scenario 1: burst of simultaneous ride requests ------------------
export function rideRequestBurst() {
  const rider = riders[__VU % riders.length];
  const token = loginAndGetToken(rider.username, rider.password);
  if (!token) {
    rideRequestErrors.add(1);
    return;
  }

  // Randomize pickup slightly so requests aren't all identical rows —
  // more realistic, and avoids accidentally testing a cache instead of
  // real matching logic. Coordinates are roughly central Johannesburg;
  // swap for wherever your real launch city is.
  const jitter = () => (Math.random() - 0.5) * 0.05;

  const payload = JSON.stringify({
    pickup_label_in: "Load Test Pickup",
    pickup_address_in: "123 Test Street",
    pickup_lat_in: -26.2041 + jitter(),
    pickup_lng_in: 28.0473 + jitter(),
    destination_label_in: "Load Test Destination",
    destination_address_in: "456 Test Avenue",
    destination_lat_in: -26.1076 + jitter(),
    destination_lng_in: 28.0567 + jitter(),
    estimated_distance_km_in: 12.4,
    estimated_duration_min_in: 22,
    ride_tier_in: "economy",
    stops_in: [],
  });

  const start = Date.now();
  const res = http.post(`${SUPABASE_URL}/rest/v1/rpc/request_ride`, payload, {
    headers: authedHeaders(token),
  });
  rideRequestDuration.add(Date.now() - start);

  const ok = check(res, {
    "request_ride returned 2xx": (r) => r.status >= 200 && r.status < 300,
  });
  if (!ok) rideRequestErrors.add(1);

  sleep(1);
}

// --- Scenario 2: two drivers race to accept the same ride -------------
// Requires a rideId you've already created (e.g. via the Supabase SQL
// editor or the app itself) and passed in as RIDE_ID. Every VU in this
// scenario is a different driver hitting accept_ride on the SAME ride at
// (as close to) the same instant, to prove only one can ever win.
export function acceptRace() {
  const RIDE_ID = __ENV.RIDE_ID;
  if (!RIDE_ID) {
    throw new Error("Set RIDE_ID env var to a real pending ride before running this scenario.");
  }

  const driver = drivers[__VU % drivers.length];
  const token = loginAndGetToken(driver.username, driver.password);

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/accept_ride`,
    JSON.stringify({ ride_id_in: RIDE_ID }),
    { headers: authedHeaders(token) }
  );

  if (res.status >= 200 && res.status < 300) {
    acceptRaceDoubleWins.add(1); // if this metric ends up > 1, you have a real bug
  }
}

export const options = {
  scenarios: {
    rideRequestBurst: {
      executor: "shared-iterations",
      vus: 1000,
      iterations: 1000,
      maxDuration: "2m",
      exec: "rideRequestBurst",
    },
    // Run separately with --scenario acceptRace, not alongside the burst —
    // see the RUN comment at the top.
    acceptRace: {
      executor: "shared-iterations",
      vus: 20,
      iterations: 20,
      maxDuration: "10s",
      exec: "acceptRace",
      startTime: "0s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"], // flag if 95th percentile exceeds 3s
    ride_request_errors: ["count<10"], // flag if more than a handful of requests error out
    accept_race_double_wins: ["count<=1"], // MUST stay at 1 — anything higher is a double-booking bug
  },
};
