// Static pin images for HMS Map Kit markers. HMS's React Native Marker
// (unlike react-native-maps') takes an image `icon`, not arbitrary JSX
// children — these are pre-rendered to visually match the custom marker
// Views used on the Google/react-native-maps side (see assets/map-pins/
// and gen_pins.py-style source if you need to regenerate them).
//
// require() paths must be static for Metro to bundle them. HMS's
// BitmapDescriptor marker icon takes a { uri } string, not a raw require()
// module id (that's react-native-maps'/<Image>'s convention) — resolve
// each through Image.resolveAssetSource to get a usable uri.
import { Image } from "react-native";

function pin(mod: number) {
  return Image.resolveAssetSource(mod).uri;
}

const RAW = {
  pickup: require("../../../assets/map-pins/pickup.png"),
  destination: require("../../../assets/map-pins/destination.png"),
  driver: require("../../../assets/map-pins/driver.png"),
  request: require("../../../assets/map-pins/request-pin.png"),
  stopDone: require("../../../assets/map-pins/stop-done.png"),
  stop: [
    require("../../../assets/map-pins/stop-1.png"),
    require("../../../assets/map-pins/stop-2.png"),
    require("../../../assets/map-pins/stop-3.png"),
    require("../../../assets/map-pins/stop-4.png"),
    require("../../../assets/map-pins/stop-5.png"),
    require("../../../assets/map-pins/stop-6.png"),
    require("../../../assets/map-pins/stop-7.png"),
    require("../../../assets/map-pins/stop-8.png"),
    require("../../../assets/map-pins/stop-9.png"),
  ],
};

// Pre-resolved { uri } BitmapDescriptors, ready to pass straight to an
// HMSMarker's `icon` prop.
export const PINS = {
  pickup: { uri: pin(RAW.pickup) },
  destination: { uri: pin(RAW.destination) },
  driver: { uri: pin(RAW.driver) },
  request: { uri: pin(RAW.request) },
  stopDone: { uri: pin(RAW.stopDone) },
  stop: RAW.stop.map((m: number) => ({ uri: pin(m) })),
};

// HMS stop pins only go up to 9 explicit numbered assets — beyond that,
// reuse the last one rather than crashing (multi-stop rides this long are
// not expected in practice, but this keeps it non-fatal).
export function stopPin(indexOneBased: number, reached: boolean) {
  if (reached) return PINS.stopDone;
  const i = Math.min(indexOneBased, PINS.stop.length) - 1;
  return PINS.stop[i];
}
