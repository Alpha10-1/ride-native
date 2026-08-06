// Routes to the Google (react-native-maps) or HMS (HMS Map Kit)
// implementation depending on whether the device has Google Play
// Services or Huawei Mobile Services. See src/lib/mobileServices.ts.
import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useMobileServiceProvider } from "../hooks/useMobileServiceProvider";
import MapPickerGoogle from "./map/MapPickerGoogle";
import MapPickerHms from "./map/MapPickerHms";

type Props = {
  initialCenter: [number, number]; // [lng, lat]
  onConfirm: (coords: { latitude: number; longitude: number }) => void;
};

export default function MapPicker(props: Props) {
  const provider = useMobileServiceProvider();

  if (provider === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return provider === "hms" ? <MapPickerHms {...props} /> : <MapPickerGoogle {...props} />;
}
