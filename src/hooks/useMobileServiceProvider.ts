import { useEffect, useState } from "react";
import { detectMobileServiceProvider, MobileServiceProvider } from "../lib/mobileServices";

// Returns null while detection is in flight (first render, always Android-
// only work), then "gms" or "hms". Map screens use this to pick between
// react-native-maps (PROVIDER_GOOGLE) and HMS Map Kit.
export function useMobileServiceProvider(): MobileServiceProvider | null {
  const [provider, setProvider] = useState<MobileServiceProvider | null>(null);

  useEffect(() => {
    let mounted = true;
    detectMobileServiceProvider().then((p) => { if (mounted) setProvider(p); });
    return () => { mounted = false; };
  }, []);

  return provider;
}
