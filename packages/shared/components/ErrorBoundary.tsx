import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";
import PrimaryButton from "./PrimaryButton";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// Without a boundary like this, ANY uncaught exception thrown during
// render — anywhere in the tree, on any screen — takes the whole app
// down in a production Hermes build. There's no redbox to see, no
// stack trace, nothing: from the person's point of view the app just
// closes itself. Wrapping the root in this turns that into a
// recoverable in-app screen instead, and gives us a place to actually
// log what threw.
//
// This only catches errors during render/lifecycle of the subtree
// below it (React's error boundary contract) — it does NOT catch
// errors inside async callbacks, event handlers, or promise
// rejections. Those are already individually try/caught throughout
// the app (see the getX().catch(...) pattern used everywhere), which
// is why they don't crash the app today. If a *new* crash report ever
// points to an async callback instead of a render, the fix belongs at
// that call site, not here.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // TODO: wire this into Sentry/Bugsnag once one is set up — this is
    // the single place in the app that would catch a render crash, so
    // it's the right place to report it. Until then this at least
    // survives in device logs (adb logcat / Xcode console) instead of
    // vanishing along with the crash.
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
    try {
      router.replace("/");
    } catch {
      // If navigation itself is what's broken, at least the error
      // state above is cleared so re-render doesn't immediately loop.
    }
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <View style={styles.card}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              The app hit an unexpected error. You can try going back to the
              home screen — if this keeps happening, let support know what
              you were doing right before it appeared.
            </Text>
            <PrimaryButton label="Back to Home" onPress={this.handleReset} />
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#0a0a0a",
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderRed,
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    color: COLORS.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
