import { supabase } from "./supabase";

// supabase-js's functions.invoke() has no built-in timeout — a stalled
// request (cold start that never returns, flaky mobile network, etc.)
// just hangs rather than rejecting or resolving. Left unguarded, that
// leaves whatever UI is waiting on it — "Confirming...", "Processing...",
// "Starting checkout..." — stuck forever with no way for the user to
// recover short of force-closing the app.
//
// Every Edge Function call in the app should go through this instead of
// calling supabase.functions.invoke directly, so the gap can't reopen
// call site by call site. Resolves with an error (rather than rejecting)
// on timeout so it drops straight into the existing `if (error)` handling
// every caller already has — no call site needs to change its logic,
// just swap the function it calls.
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  options?: { body?: Record<string, unknown> },
  timeoutMs = 15_000
): Promise<{ data: T | null; error: any }> {
  return Promise.race([
    supabase.functions.invoke(functionName, options) as Promise<{ data: T | null; error: any }>,
    new Promise<{ data: null; error: any }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            data: null,
            error: new Error(`${functionName} timed out. Check your connection and try again.`),
          }),
        timeoutMs
      )
    ),
  ]);
}
