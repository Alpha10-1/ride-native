// Routes to the Google (react-native-maps) or HMS (HMS Map Kit)
// implementation depending on whether the device has Google Play
// Services or Huawei Mobile Services. See src/lib/mobileServices.ts.
import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useMobileServiceProvider } from "../hooks/useMobileServiceProvider";
import RiderMapGoogle from "./map/RiderMapGoogle";
import RiderMapHms from "./map/RiderMapHms";

type Props = {
  centerCoordinate: [number, number]; // [lng, lat]
  zoomLevel?: number;
};

export default function RiderMap(props: Props) {
  const provider = useMobileServiceProvider();

  if (provider === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return provider === "hms" ? <RiderMapHms {...props} /> : <RiderMapGoogle {...props} />;
}
