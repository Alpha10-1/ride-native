// Wires Huawei Mobile Services (HMS Core) into the native Android build:
// the Huawei Maven repo, the AGConnect Gradle plugin, and copying
// agconnect-services.json into android/app/ during `expo prebuild`.
//
// IMPORTANT: the Huawei Maven repo (developer.huawei.com/repo) is added
// UNCONDITIONALLY, regardless of whether agconnect-services.json exists.
// This isn't optional — installing @hmscore/react-native-hms-map (etc.)
// makes React Native's autolinking pull those modules' native Android
// code into the build automatically, and that native code depends on
// com.huawei.hms:* artifacts that only exist on Huawei's Maven repo. If
// that repo isn't declared, Gradle fails to resolve those dependencies
// even on a build that will never run on Huawei hardware — this repo is
// public and needs no credentials, so there's no downside to always
// including it.
//
// The AGConnect Gradle *plugin application* (`apply plugin:
// "com.huawei.agconnect"`) is different — it actively parses
// agconnect-services.json at build time and fails without it, so that
// part (and copying the file into android/app/) stays gated on the file
// being present.
//
// Usage — add to app.json's "plugins" array:
//   ["./plugins/withHmsCore", {}]
//
// Requires: npm install @hmscore/react-native-hms-map @hmscore/react-native-hms-location @hmscore/react-native-hms-availability
//
// NOTE: this has not been run through an actual `expo prebuild` +
// Android build against real HMS credentials — the Maven-repo fix here
// was verified against a real build failure, but the AGConnect
// plugin-application path (once you have agconnect-services.json) still
// hasn't been. Sanity-check android/build.gradle and
// android/app/build.gradle after your first prebuild with real
// credentials, and compare against Huawei's "Integrating the AppGallery
// Connect Plugin" docs if it fails.
const fs = require("fs");
const path = require("path");
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");

const AGCONNECT_SERVICES_FILENAME = "agconnect-services.json";

function hasAgConnectConfig(projectRoot) {
  return fs.existsSync(path.join(projectRoot, AGCONNECT_SERVICES_FILENAME));
}

const HUAWEI_MAVEN_REPO = 'maven { url "https://developer.huawei.com/repo/" }';
const AGCONNECT_CLASSPATH = "classpath 'com.huawei.agconnect:agcp:1.9.3.301'";
const AGCONNECT_APPLY = "apply plugin: 'com.huawei.agconnect'";

// Huawei's AGConnect Gradle plugin (AGCPlugin.groovy) parses the
// buildscript.dependencies block as TEXT, scanning for a
// "com.android.tools.build:gradle:VERSION" string with an explicit
// version, in order to decide how to hook into the Android build. It
// throws "com.android.tools.build:gradle is no set in the build.gradle
// file" if it can't find one.
//
// Modern Expo/RN templates don't declare AGP with a pinned version in
// this block anymore — the generated line is the unversioned
// `classpath("com.android.tools.build:gradle")`, with the actual version
// resolved separately via settings.gradle's plugin management block
// (expoAutolinking.useExpoVersionCatalog(), which reads AGP's version
// from react-native/gradle/libs.versions.toml). That resolution works
// fine for Gradle itself, but AGConnect's plugin can't see it — it only
// looks at this file's text.
//
// This is a known, documented incompatibility, not specific to this
// project — see https://github.com/HMS-Core/hms-flutter-plugin/issues/398
// and https://github.com/HMS-Core/hms-react-native-plugin/issues/301.
//
// Fix: add a second, explicitly-versioned classpath line for AGConnect's
// benefit. We pin it to match whatever version React Native's own
// version catalog resolves to, read live from
// node_modules/react-native/gradle/libs.versions.toml, so this doesn't
// silently drift out of sync if RN is upgraded later. Having both the
// unversioned line (which Expo/RN's own tooling relies on) and this
// versioned one is safe: they resolve to the identical artifact, so
// Gradle doesn't see a real version conflict.
function resolveReactNativeAgpVersion(projectRoot) {
  const catalogPath = path.join(
    projectRoot,
    "node_modules",
    "react-native",
    "gradle",
    "libs.versions.toml"
  );
  if (!fs.existsSync(catalogPath)) return null;
  const contents = fs.readFileSync(catalogPath, "utf8");
  const match = contents.match(/^agp\s*=\s*["']([^"']+)["']/m);
  return match ? match[1] : null;
}

function withHmsProjectGradle(config) {
  return withProjectBuildGradle(config, (config) => {
    // Always runs — see the note at the top of this file for why the
    // repo/classpath additions aren't gated on agconnect-services.json.
    let contents = config.modResults.contents;

    if (!contents.includes(HUAWEI_MAVEN_REPO)) {
      // Add the Huawei Maven repo everywhere Google's/Maven Central's repo
      // is declared (buildscript.repositories and allprojects.repositories).
      contents = contents.replace(
        /repositories\s*{/g,
        (match) => `${match}\n        ${HUAWEI_MAVEN_REPO}`
      );
    }

    // See the comment above resolveReactNativeAgpVersion for why this is
    // needed: AGConnect's plugin can't parse the unversioned AGP
    // classpath line that Expo/RN's own template generates.
    const agpVersion = resolveReactNativeAgpVersion(
      config.modRequest.projectRoot
    );
    if (agpVersion) {
      const versionedAgpClasspath = `classpath 'com.android.tools.build:gradle:${agpVersion}'`;
      if (!contents.includes(versionedAgpClasspath)) {
        contents = contents.replace(
          /dependencies\s*{/,
          (match) => `${match}\n        ${versionedAgpClasspath}`
        );
      }
    }

    if (!contents.includes(AGCONNECT_CLASSPATH)) {
      contents = contents.replace(
        /dependencies\s*{/,
        (match) => `${match}\n        ${AGCONNECT_CLASSPATH}`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withHmsAppGradle(config) {
  return withAppBuildGradle(config, (config) => {
    // Gated: applying this plugin without agconnect-services.json present
    // makes the AGConnect Gradle plugin itself fail, since it parses that
    // file at build time.
    if (!hasAgConnectConfig(config.modRequest.projectRoot)) return config;
    let contents = config.modResults.contents;

    if (!contents.includes(AGCONNECT_APPLY)) {
      // Must come after the existing `apply plugin: "com.android.application"`
      // line for AGConnect's Gradle plugin to pick up the app config.
      contents = contents.replace(
        /apply plugin: ["']com\.android\.application["']/,
        (match) => `${match}\n${AGCONNECT_APPLY}`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withAgConnectServicesJson(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, AGCONNECT_SERVICES_FILENAME);
      if (!fs.existsSync(src)) return config;

      const destDir = path.join(config.modRequest.platformProjectRoot, "app");
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, path.join(destDir, AGCONNECT_SERVICES_FILENAME));
      return config;
    },
  ]);
}

module.exports = function withHmsCore(config) {
  config = withHmsProjectGradle(config);
  config = withHmsAppGradle(config);
  config = withAgConnectServicesJson(config);
  return config;
};