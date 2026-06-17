import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import SegmentedTabs from "../../src/components/SegmentedTabs";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import RoleCard from "../../src/components/RoleCard";
import TermsModal from "../../src/components/TermsModal";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { registerUser, loginUser } from "../../src/lib/auth";

type Mode = "login" | "register";
type Role = "rider" | "driver" | null;

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [termsVisible, setTermsVisible] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // shared
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // register - account info
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cellphone, setCellphone] = useState("");
  const [dob, setDob] = useState("");

  // register - role
  const [role, setRole] = useState<Role>(null);

  // register - driver fields
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  const isRegister = mode === "register";
  const isDriver = role === "driver";

  const canContinue = useMemo(() => {
    if (!isRegister) {
      return !!username.trim() && !!password;
    }

    // register validation
    if (!username.trim() || !password || !confirm) return false;
    if (password !== confirm) return false;
    if (!firstName.trim() || !lastName.trim()) return false;
    if (!email.trim() || !cellphone.trim() || !dob.trim()) return false;
    if (!role) return false;
    if (isDriver) {
      if (!licenseNumber.trim() || !vehicleMake.trim() || !vehicleModel.trim() || !licensePlate.trim()) {
        return false;
      }
    }
    if (!agreedToTerms) return false;

    return true;
  }, [
    isRegister,
    username,
    password,
    confirm,
    firstName,
    lastName,
    email,
    cellphone,
    dob,
    role,
    isDriver,
    licenseNumber,
    vehicleMake,
    vehicleModel,
    licensePlate,
    agreedToTerms,
  ]);

  const handleSwitchMode = (next: Mode) => {
    setMode(next);
    setSubmitError(null);
  };

  // Converts "DD/MM/YYYY" -> "YYYY-MM-DD" for Postgres. Returns null if invalid.
  const toIsoDate = (input: string): string | null => {
    const match = input.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const day = Number(dd);
    const month = Number(mm);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
  };

  const handleSubmit = async () => {
    if (!canContinue || submitting) return;
    setSubmitError(null);

    if (isRegister) {
      const isoDob = toIsoDate(dob);
      if (!isoDob) {
        setSubmitError("Please enter date of birth as DD/MM/YYYY.");
        return;
      }

      setSubmitting(true);
      try {
        await registerUser({
          username,
          password,
          firstName,
          lastName,
          email,
          cellphone,
          dateOfBirth: isoDob,
          role: role as "rider" | "driver",
          driverLicenseNumber: licenseNumber,
          vehicleMake,
          vehicleModel,
          licensePlate,
        });
        router.replace("/auth/role");
      } catch (e: any) {
        const message = e?.message ?? "Something went wrong creating your account.";
        if (message.toLowerCase().includes("already registered")) {
          setSubmitError("That username is already taken.");
        } else {
          setSubmitError(message);
        }
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await loginUser(username, password);
        router.replace("/auth/role");
      } catch (e: any) {
        setSubmitError(e?.message ?? "Something went wrong signing in.");
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>
            <Text style={{ color: COLORS.text }}>R</Text>
            <Text style={{ color: COLORS.red }}>ide</Text>
          </Text>
          <Text style={styles.tagline}>South Africa&apos;s Mobility Platform</Text>

          <Text style={styles.h2}>{isRegister ? "Create Account" : "Welcome Back"}</Text>
          <Text style={styles.sub}>
            {isRegister ? "Register to start using Ride" : "Sign in to continue to your account"}
          </Text>

          <View style={{ marginTop: SPACE.md, width: "100%" }}>
            <SegmentedTabs value={mode} onChange={handleSwitchMode} />
          </View>
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.cardTitle}>{isRegister ? "Register" : "Login"}</Text>
          <Text style={styles.cardSub}>
            {isRegister ? "Create your account to get moving" : "Enter your credentials to sign in"}
          </Text>

          <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
            <TextField label="Username" placeholder="admin@org.com" value={username} onChangeText={setUsername} />
            <TextField
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {isRegister && (
              <>
                <TextField
                  label="Confirm Password"
                  placeholder="Confirm your password"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                />
                <TextField label="First Name" placeholder="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
                <TextField label="Last Name" placeholder="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
                <TextField label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
                <TextField label="Cellphone" placeholder="082 123 4567" value={cellphone} onChangeText={setCellphone} keyboardType="phone-pad" />
                <TextField label="Date of Birth" placeholder="DD/MM/YYYY" value={dob} onChangeText={setDob} keyboardType="numeric" />

                <Text style={[styles.label, { marginTop: SPACE.sm }]}>I want to</Text>
                <View style={styles.roleRow}>
                  <RoleCard
                    icon="person-outline"
                    title="Rider"
                    subtitle="Book rides"
                    selected={role === "rider"}
                    onPress={() => setRole("rider")}
                  />
                  <RoleCard
                    icon="car-sport-outline"
                    title="Driver"
                    subtitle="Give rides & earn"
                    selected={role === "driver"}
                    onPress={() => setRole("driver")}
                  />
                </View>

                {isDriver && (
                  <View style={{ gap: SPACE.sm, marginTop: SPACE.sm }}>
                    <Text style={styles.sectionTitle}>Driver Details</Text>
                    <TextField label="Driver License #" placeholder="Enter license number" value={licenseNumber} onChangeText={setLicenseNumber} />
                    <TextField label="Vehicle Make" placeholder="e.g. Toyota" value={vehicleMake} onChangeText={setVehicleMake} autoCapitalize="words" />
                    <TextField label="Vehicle Model" placeholder="e.g. Corolla" value={vehicleModel} onChangeText={setVehicleModel} autoCapitalize="words" />
                    <TextField label="License Plate" placeholder="e.g. CA 123-456" value={licensePlate} onChangeText={setLicensePlate} autoCapitalize="characters" />
                  </View>
                )}

                <Pressable
                  style={styles.termsRow}
                  onPress={() => setTermsVisible(true)}
                >
                  <Ionicons
                    name={agreedToTerms ? "checkbox" : "square-outline"}
                    size={20}
                    color={agreedToTerms ? COLORS.red : COLORS.textFaint}
                  />
                  <Text style={styles.termsTxt}>
                    {agreedToTerms ? "You agreed to the " : "Review the "}
                    <Text style={styles.termsLink}>Terms & Conditions</Text>
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={{ marginTop: SPACE.md }}>
            <PrimaryButton
              label={submitting ? "Please wait..." : isRegister ? "Continue" : "Sign In"}
              disabled={!canContinue || submitting}
              onPress={handleSubmit}
            />
          </View>

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          {isRegister && password !== confirm && confirm.length > 0 ? (
            <Text style={styles.error}>Passwords do not match.</Text>
          ) : null}
        </GlassCard>
      </ScrollView>

      <TermsModal
        visible={termsVisible}
        onClose={() => setTermsVisible(false)}
        onAgree={() => {
          setAgreedToTerms(true);
          setTermsVisible(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.xl,
    gap: SPACE.lg,
  },
  header: {
    alignItems: "center",
    gap: 6,
  },
  logo: {
    fontSize: 46,
    fontWeight: "900",
    letterSpacing: -1,
  },
  tagline: {
    color: "rgba(255,255,255,0.65)",
    marginTop: 4,
  },
  h2: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: "900",
    marginTop: SPACE.lg,
  },
  sub: {
    color: "rgba(255,255,255,0.65)",
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    gap: SPACE.sm,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  cardSub: {
    color: COLORS.textFaint,
    textAlign: "center",
  },
  label: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  sectionTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 14,
    marginTop: 4,
  },
  roleRow: {
    flexDirection: "row",
    gap: SPACE.sm,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.xs,
    marginTop: SPACE.sm,
    justifyContent: "center",
  },
  termsTxt: {
    color: COLORS.textDim,
    fontSize: 13,
  },
  termsLink: {
    color: COLORS.red,
    fontWeight: "800",
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});