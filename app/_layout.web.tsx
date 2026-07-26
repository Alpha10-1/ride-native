import React from "react";
import { Stack } from "expo-router";

export default function RootLayoutWeb() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </>
  );
}
