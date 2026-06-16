import React from "react";
import { Stack } from "expo-router";
import Head  from "expo-router/head";

export default function RootLayoutWeb() {
  return (
    <>
      <Head>
        {/* Mapbox GL JS CSS (web only) */}
        <link
          rel="stylesheet"
          href="https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css"
        />
      </Head>

      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </>
  );
}
