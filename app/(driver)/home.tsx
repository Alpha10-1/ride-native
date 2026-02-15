import { Text, View } from "react-native";
import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";

export default function DriverHome() {
  return (
    <Screen>
      <AppHeader eyebrow="Driver" title="You're online" />
      <View style={{ padding: 16 }}>
        <Text style={{ color: "#fff" }}>Driver home screen</Text>
      </View>
    </Screen>
  );
}
