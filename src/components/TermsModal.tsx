import React, { useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";

const PLACEHOLDER_TERMS = `
1. Acceptance of Terms
By creating an account and using Ride, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the app.

2. Eligibility
You must be at least 18 years old to register as a driver, and at least 16 years old to register as a rider, in accordance with applicable local law.

3. Account Responsibility
You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.

4. Driver Requirements
Drivers must hold a valid driver's license and provide accurate vehicle information. Ride reserves the right to verify any information submitted and to suspend accounts found to contain false information.

5. Conduct
Users agree to treat other users, drivers, and riders with respect. Harassment, discrimination, or unsafe behavior may result in account suspension or termination.

6. Payments
All fares and payments are processed as described in the app. Ride is not responsible for disputes between riders and drivers regarding cash transactions outside the platform.

7. Privacy
Your personal information is handled in accordance with our Privacy Policy. By using the app, you consent to the collection and use of your information as described.

8. Limitation of Liability
Ride acts as a platform connecting riders and drivers and is not liable for the conduct of users, vehicle conditions, or incidents occurring during a ride, to the maximum extent permitted by law.

9. Changes to Terms
These terms may be updated from time to time. Continued use of the app after changes constitutes acceptance of the revised terms.

10. Termination
Ride reserves the right to suspend or terminate accounts that violate these terms.

(This is placeholder text. Replace with your actual Terms and Conditions before launch.)
`.trim();

export default function TermsModal({
  visible,
  onClose,
  onAgree,
}: {
  visible: boolean;
  onClose: () => void;
  onAgree: () => void;
}) {
  const [reachedEnd, setReachedEnd] = useState(false);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Terms & Conditions</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            onScroll={({ nativeEvent }) => {
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              const closeToBottom =
                layoutMeasurement.height + contentOffset.y >= contentSize.height - 24;
              if (closeToBottom) setReachedEnd(true);
            }}
            scrollEventThrottle={100}
          >
            <Text style={styles.body}>{PLACEHOLDER_TERMS}</Text>
          </ScrollView>

          <Pressable
            style={[styles.agreeBtn, !reachedEnd && styles.agreeBtnDisabled]}
            disabled={!reachedEnd}
            onPress={onAgree}
          >
            <Text style={styles.agreeTxt}>
              {reachedEnd ? "I Agree" : "Scroll to read all terms"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderRed,
    maxHeight: "85%",
    padding: SPACE.lg,
    gap: SPACE.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "900",
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: 420,
  },
  body: {
    color: COLORS.textDim,
    fontSize: 13,
    lineHeight: 20,
  },
  agreeBtn: {
    height: 52,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  agreeBtnDisabled: {
    backgroundColor: "rgba(255,46,46,0.3)",
  },
  agreeTxt: {
    color: "#000",
    fontWeight: "900",
    fontSize: 15,
  },
});