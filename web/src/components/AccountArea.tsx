import { useRef, useState } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { ApiError } from "../api/client";
import type { AuthState } from "../hooks/auth";
import { Alert } from "./feedback";

const styles = stylex.create({
  accountControls: {
    flexWrap: "wrap",
  },
  accountInput: {
    width: "14rem",
    maxWidth: "100%",
    minHeight: "2.25rem",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-background-surface)",
    color: "var(--color-text-primary)",
    font: "inherit",
  },
});

const passwordPolicyMessage =
  "Password must be at least 8 characters (and at most 72 bytes).";

function AccountError({ error, isSignUp }: { error: Error; isSignUp: boolean }) {
  let message = "Can't reach the server. You can keep practising on this device.";
  if (error instanceof ApiError) {
    message = "Unable to complete account request. Please try again.";
    if (error.status === 409) {
      message = "This email is already registered.";
    } else if (error.status === 401) {
      message = "Invalid email or password.";
    } else if (error.status === 429) {
      message = "Too many attempts. Try again in a few minutes.";
    } else if (error.status === 400 && isSignUp) {
      message = `Check your email address and password. ${passwordPolicyMessage}`;
    }
  }

  return <Alert>{message}</Alert>;
}

export function AccountArea({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastAction, setLastAction] = useState<"signIn" | "signUp" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // Signing in or out swaps the form and the signed-in row, so focus moves to the control that replaced it.
  const moveFocus = useRef<"signedIn" | "signedOut" | null>(null);
  const takeFocus = (target: "signedIn" | "signedOut") => (element: HTMLElement | null) => {
    if (element && moveFocus.current === target) {
      moveFocus.current = null;
      element.focus();
    }
  };

  const submit = async (action: AuthState["signIn"], isSignUp: boolean) => {
    setLastAction(isSignUp ? "signUp" : "signIn");
    setLocalError(null);
    if (isSignUp && (Array.from(password).length < 8 || new TextEncoder().encode(password).byteLength > 72)) {
      setLocalError(passwordPolicyMessage);
      return;
    }
    moveFocus.current = "signedIn";
    try {
      await action(email, password);
      setPassword("");
    } catch {
      moveFocus.current = null;
      // The hook exposes the error for the inline account message.
    }
  };

  if (auth.user) {
    return (
      <VStack gap={1}>
        <HStack gap={1} align="center" xstyle={styles.accountControls}>
          <Text type="supporting">{auth.user.email}</Text>
          <Button
            ref={takeFocus("signedIn")}
            label="Sign out"
            variant="secondary"
            onClick={() => {
              moveFocus.current = "signedOut";
              auth.signOut().catch(() => {
                moveFocus.current = null;
              });
            }}
          />
        </HStack>
        {auth.error && <AccountError error={auth.error} isSignUp={false} />}
      </VStack>
    );
  }

  return (
    <VStack gap={1}>
      <form ref={form} onSubmit={(event) => {
        event.preventDefault();
        void submit(auth.signIn, false);
      }}>
        <HStack gap={1} align="center" xstyle={styles.accountControls}>
          <input
            ref={takeFocus("signedOut")}
            aria-label="Email"
            className={stylex.props(styles.accountInput).className}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
          />
          <input
            aria-label="Password"
            className={stylex.props(styles.accountInput).className}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
          />
          {/* Enter submits the form, so its default action, Sign in, is the primary button. */}
          <Button label="Sign in" variant="primary" type="submit" />
          <Button
            label="Sign up"
            variant="secondary"
            type="button"
            onClick={() => {
              if (form.current?.reportValidity()) {
                void submit(auth.signUp, true);
              }
            }}
          />
        </HStack>
      </form>
      {auth.expired && <Alert>You were signed out. Sign in again to sync.</Alert>}
      {localError && <Alert>{localError}</Alert>}
      {auth.error && <AccountError error={auth.error} isSignUp={lastAction === "signUp"} />}
    </VStack>
  );
}
