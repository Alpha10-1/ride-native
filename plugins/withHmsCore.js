// Wires Huawei Mobile Services (HMS Core) into the native Android build:
// the Huawei Maven repo, the AGConnect Gradle plugin, and copying
// agconnect-services.json into android/app/ during `expo prebuild`.
//
// Deliberately a no-op if agconnect-services.json isn't present at the
// project root — that's the signal that HMS/AppGallery Connect setup
// (see the Huawei Developer Console steps) hasn't been done yet. This
// keeps `expo prebuild` working for anyone who hasn't done that setup,
// instead of failing the whole Android build over a missing Huawei
// config file.
//
// Usage — add to app.json's "plugins" array:
//   ["./plugins/withHmsCore", {}]
//
// Requires, once agconnect-services.json is in place:
//   npm install @hmscore/react-native-hms-map @hmscore/react-native-hms-location @hmscore/react-native-hms-availability
//
// NOTE: this has not been run through an actual `expo prebuild` +
// Android build — there's no HMS-registered app / agconnect-services.json
// available in this environment to test against. Sanity-check the
// generated android/build.gradle and android/app/build.gradle after your
// first prebuild once you have real credentials, and compare against
// Huawei's "Integrating the AppGallery Connect Plugin" docs if the build
// fails.
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

function withHmsProjectGradle(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!hasAgConnectConfig(config.modRequest.projectRoot)) return config;
    let contents = config.modResults.contents;

    if (!contents.includes(HUAWEI_MAVEN_REPO)) {
      // Add the Huawei Maven repo everywhere Google's/Maven Central's repo
      // is declared (buildscript.repositories and allprojects.repositories).
      contents = contents.replace(
        /repositories\s*{/g,
        (match) => `${match}\n        ${HUAWEI_MAVEN_REPO}`
      );
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
