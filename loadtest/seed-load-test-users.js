// Seeds disposable rider + driver accounts for load testing, and writes
// riders.json / drivers.json for ride-request-burst.js to read.
//
// RUN AGAINST STAGING ONLY. This uses the service-role key to bypass
// email verification, so a leaked service-role key here is as dangerous
// as anywhere else in this codebase — never run this against production
// or commit the generated .json files (already covered by .gitignore
// below, double-check before committing regardless).
//
// USAGE:
//   export SUPABASE_URL="https://<staging-project-ref>.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="<staging service role key>"
//   node loadtest/seed-load-test-users.js --riders 1000 --drivers 50

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? parseInt(args[i + 1], 10) : fallback;
}

const RIDER_COUNT = argValue("riders", 1000);
const DRIVER_COUNT = argValue("drivers", 50);
const PASSWORD = "LoadTest!2026"; // disposable staging-only accounts

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function seedAccount(username, role) {
  const email = `${username}@ridenative.internal`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`Failed to create ${username}:`, error.message);
    return null;
  }
  // Adjust this to match whatever your profiles table actually requires
  // (role, verification_status, etc.) — see src/lib/auth.ts registerUser
  // for the fields this project sets on real signup.
  await admin
    .from("profiles")
    .update({ role, username, verification_status: role === "driver" ? "verified" : undefined })
    .eq("id", data.user.id);
  return { username, password: PASSWORD };
}

async function main() {
  console.log(`Seeding ${RIDER_COUNT} riders + ${DRIVER_COUNT} drivers on ${SUPABASE_URL}...`);

  const riders = [];
  for (let i = 0; i < RIDER_COUNT; i++) {
    const acc = await seedAccount(`loadtest_rider_${i}`, "rider");
    if (acc) riders.push(acc);
    if (i % 50 === 0) console.log(`  riders: ${i}/${RIDER_COUNT}`);
  }

  const drivers = [];
  for (let i = 0; i < DRIVER_COUNT; i++) {
    const acc = await seedAccount(`loadtest_driver_${i}`, "driver");
    if (acc) drivers.push(acc);
  }

  fs.writeFileSync("loadtest/riders.json", JSON.stringify(riders, null, 2));
  fs.writeFileSync("loadtest/drivers.json", JSON.stringify(drivers, null, 2));
  console.log(`Done. Wrote ${riders.length} riders and ${drivers.length} drivers.`);
  console.log("Remember: delete these accounts (or wipe the staging project) after testing.");
}

main();
