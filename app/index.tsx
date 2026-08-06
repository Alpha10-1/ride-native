import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";

import Screen from "../src/components/Screen";
import { COLORS } from "../src/theme/tokens";
import { supabase } from "../src/lib/supabase";
import { redirectAfterAuth } from "../src/lib/auth";
import { resetTo } from "../src/lib/navigation";

// App entry point. Sessions persist to AsyncStorage (see src/lib/supabase.ts),
// so on every fresh launch we check for one before deciding where to land —
// a signed-in user should go straight to their home screen and stay logged
// in until they explicitly log out, not be dropped back on the login form
// just because the app was closed and reopened.
export default function AppIndex() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        resetTo("/auth/login");
        return;
      }

      // Handles suspension/staff checks and role/active_mode routing the
      // same way a fresh login does.
      await redirectAfterAuth();
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      {checking ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : null}
    </Screen>
  );
}
