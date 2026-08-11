import React, { useCallback, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";

export type ThemedAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

type AlertState = {
  visible: boolean;
  title?: string;
  message?: string;
  buttons: ThemedAlertButton[];
};

const INITIAL_STATE: AlertState = { visible: false, buttons: [] };

// Module-level bridge so `Alert.alert(...)` can be called imperatively from
// anywhere — screens, hooks, lib/*.ts — exactly like the real RN Alert,
// without every caller needing access to React context.
let dispatch: ((title?: string, message?: string, buttons?: ThemedAlertButton[]) => void) | null = null;

/**
 * Drop-in replacement for React Native's `Alert`. Same call signature
 * (`Alert.alert(title, message, buttons)`), but renders as a themed modal
 * matching the app's dark/red styling instead of the OS system dialog.
 * Requires <AlertProvider> to be mounted (see app/_layout.tsx).
 */
export const Alert = {
  alert(title?: string, message?: string, buttons?: ThemedAlertButton[]) {
    if (dispatch) {
      dispatch(title, message, buttons);
    } else if (__DEV__) {
      console.warn("[themedAlert] AlertProvider not mounted yet:", title, message);
    }
  },
};

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AlertState>(INITIAL_STATE);

  const hide = useCallback(() => setState((s) => ({ ...s, visible: false })), []);

  dispatch = (title, message, buttons) => {
    setState({
      visible: true,
      title,
      message,
      buttons: buttons && buttons.length ? buttons : [{ text: "OK", style: "default" }],
    });
  };

  const handlePress = (btn: ThemedAlertButton) => {
    hide();
    // Let the modal's close animation start before firing onPress, so any
    // navigation it triggers doesn't visually collide with the dismiss.
    setTimeout(() => btn.onPress?.(), 80);
  };

  const stacked = state.buttons.length > 2;
  const isWarning =
    /couldn'?t|error|failed|fail|denied|suspended|required|unavailable/i.test(state.title ?? "");

  return (
    <>
      {children}
      <Modal visible={state.visible} transparent animationType="fade" onRequestClose={hide}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            {isWarning && (
              <View style={styles.iconWrap}>
                <Ionicons name="alert-circle" size={28} color={COLORS.red} />
              </View>
            )}
            {!!state.title && <Text style={styles.title}>{state.title}</Text>}
            {!!state.message && <Text style={styles.message}>{state.message}</Text>}

            <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
              {state.buttons.map((btn, i) => (
                <Pressable
                  key={i}
                  onPress={() => handlePress(btn)}
                  style={({ pressed }) => [
                    styles.button,
                    stacked && styles.buttonFull,
                    btn.style === "cancel" && styles.buttonCancel,
                    btn.style === "destructive" && styles.buttonDestructive,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      btn.style === "cancel" && styles.buttonTextCancel,
                      btn.style === "destructive" && styles.buttonTextDestructive,
                    ]}
                  >
                    {btn.text ?? "OK"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.xl,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#0a0a0a",
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderRed,
    padding: SPACE.lg,
    gap: SPACE.xs,
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  iconWrap: {
    alignItems: "center",
    marginBottom: 2,
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    color: COLORS.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 2,
  },
  buttons: {
    flexDirection: "row",
    gap: SPACE.xs,
    marginTop: SPACE.md,
  },
  buttonsStacked: {
    flexDirection: "column",
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonFull: {
    flex: undefined,
    width: "100%",
  },
  buttonCancel: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonDestructive: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,46,46,0.5)",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 15,
  },
  buttonTextCancel: {
    color: COLORS.textDim,
  },
  buttonTextDestructive: {
    color: COLORS.red,
  },
});
