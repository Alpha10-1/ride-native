import { Text, View } from "react-native";
import { useState } from "react";
import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";

export default function DriverHome() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Screen>
      <RiderHeader
        subtitle="You're online"
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />
      <View style={{ padding: 16 }}>
        <Text style={{ color: "#fff" }}>Driver home screen</Text>
      </View>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}