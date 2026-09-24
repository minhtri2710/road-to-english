import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import { ApiError } from "../api/client";
import type { AuthState } from "../hooks/auth";
import { Alert } from "./feedback";
import { sharedStyles } from "./styles";

const styles = stylex.create({
  accountControls: {
    flexWrap: "wrap",
  },
  // The password input gives up width so Show password stays beside it.
  passwordInput: {
    flexShrink: 1,
    minWidth: 0,
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

type Mode = "signIn" | "signUp";

const shortPasswordMessage = "Password must be at least 8 characters.";
const passwordPolicyMessage =
  "Password must be at least 8 characters (and at most 72 bytes).";

function waitText(seconds: number): string {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
}

function AccountError({ error }: { error: Error }) {
  let message = "Can't reach the server. You can keep practising on this device.";
  if (error instanceof ApiError) {
    message = "Unable to complete account request. Please try again.";
    if (error.status === 401) {
      message = "Invalid email or password.";
    } else if (error.status === 429) {
      message = "Too many attempts. Try again in a few minutes.";
    }
  }

  return <Alert>{message}</Alert>;
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Text as="p" id={id} color="primary" xstyle={sharedStyles.error}>
      {children}
    </Text>
  );
}

export function AccountArea({ auth }: { auth: AuthState }) {
  const { clearError } = auth;
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordShown, setPasswordShown] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Signed out, the form sits behind a "Sign in" disclosure so the header stays short.
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLButtonElement | null>(null);
  // The countdown's seconds left for the 429 it belongs to.
  const [countdown, setCountdown] = useState<{ error: Error; left: number } | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const ids = useId();
  // Signing in or out swaps the form and the signed-in row, so focus moves to the control that replaced it;
  // expanding the form moves focus to Email.
  const moveFocus = useRef<"signedIn" | "signedOut" | "form" | null>(null);
  const takeFocus = (target: "signedIn" | "signedOut" | "form") => (element: HTMLElement | null) => {
    if (element && moveFocus.current === target) {
      moveFocus.current = null;
      element.focus();
    }
  };

  const status = auth.error instanceof ApiError ? auth.error.status : null;
  const retryAfter = auth.error instanceof ApiError && status === 429 ? auth.error.retryAfter : null;
  const secondsLeft = retryAfter === null ? null : countdown?.error === auth.error ? countdown.left : retryAfter;
  const emailTaken = mode === "signUp" && status === 409;
  const passwordRejected = mode === "signUp" && status === 400;
  const passwordError =
    localError ?? (passwordRejected ? `Check your email address and password. ${passwordPolicyMessage}` : null);
  const formError = auth.error && !emailTaken && !passwordRejected && retryAfter === null ? auth.error : null;
  // An error or countdown on screen keeps the form open: Escape, Close and the disclosure do not collapse it.
  const locked = emailTaken || passwordError !== null || formError !== null || secondsLeft !== null;

  const collapse = () => {
    if (locked) {
      return;
    }
    setOpen(false);
    disclosure.current?.focus();
  };

  // Counts a 429's Retry-After down once per second, then clears the error so submit re-enables.
  useEffect(() => {
    const limited = auth.error;
    if (retryAfter === null || limited === null) {
      return;
    }
    let left = retryAfter;
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCountdown({ error: limited, left });
        return;
      }
      clearInterval(timer);
      clearError();
    }, 1000);
    return () => clearInterval(timer);
  }, [auth.error, clearError]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword("");
    setPasswordShown(false);
    setLocalError(null);
    clearError();
  };

  const submit = async () => {
    if (secondsLeft !== null) {
      return;
    }
    clearError();
    setLocalError(null);
    if (mode === "signUp") {
      const rule =
        Array.from(password).length < 8
          ? shortPasswordMessage
          : new TextEncoder().encode(password).byteLength > 72
            ? passwordPolicyMessage
            : null;
      if (rule) {
        setLocalError(rule);
        passwordInput.current?.focus();
        return;
      }
    }
    moveFocus.current = "signedIn";
    try {
      await (mode === "signUp" ? auth.signUp : auth.signIn)(email, password);
      setPassword("");
      setPasswordShown(false);
      setOpen(false);
    } catch (error) {
      moveFocus.current = null;
      // The hook exposes the error; a field error takes focus to its field.
      if (mode === "signUp" && error instanceof ApiError) {
        if (error.status === 409) {
          emailInput.current?.focus();
        } else if (error.status === 400) {
          passwordInput.current?.focus();
        }
      }
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
        {auth.error && <AccountError error={auth.error} />}
      </VStack>
    );
  }

  const emailErrorId = `${ids}-email-error`;
  const passwordHelpId = `${ids}-password-help`;
  const passwordErrorId = `${ids}-password-error`;
  const formRegionId = `${ids}-account-form`;
  const passwordDescribedBy = [mode === "signUp" && !passwordError && passwordHelpId, passwordError && passwordErrorId].filter(Boolean).join(" ");

  return (
    <VStack gap={1}>
      <HStack gap={1} align="center" xstyle={styles.accountControls}>
        <Button
          ref={(element: HTMLButtonElement | null) => {
            disclosure.current = element;
            takeFocus("signedOut")(element);
          }}
          label="Sign in"
          variant="secondary"
          aria-expanded={open}
          aria-controls={formRegionId}
          onClick={() => {
            if (open) {
              collapse();
              return;
            }
            moveFocus.current = "form";
            setOpen(true);
          }}
        />
        {auth.expired && <Alert>You were signed out. Sign in again to sync.</Alert>}
      </HStack>
      {open && (
        <VStack
          gap={1}
          id={formRegionId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              collapse();
            }
          }}
        >
          <form onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}>
            <VStack gap={0.5}>
              <ToggleButtonGroup
                label="Sign in or create an account"
                value={mode}
                xstyle={styles.accountControls}
                onChange={(next) => {
                  if (next) {
                    switchMode(next as Mode);
                  }
                }}
              >
                <ToggleButton value="signIn" label="Sign in" />
                <ToggleButton value="signUp" label="Create account" />
              </ToggleButtonGroup>
              <VStack gap={0.5}>
                <label htmlFor={`${ids}-email`}>
                  <Text as="span" type="supporting">Email</Text>
                </label>
                <input
                  ref={(element) => {
                    emailInput.current = element;
                    takeFocus("form")(element);
                  }}
                  id={`${ids}-email`}
                  className={stylex.props(styles.accountInput).className}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={emailTaken || undefined}
                  aria-describedby={emailTaken ? emailErrorId : undefined}
                  required
                />
                {emailTaken && (
                  <FieldError id={emailErrorId}>
                    This email is already registered.{" "}
                    <Button
                      label="Sign in instead?"
                      variant="secondary"
                      onClick={() => {
                        switchMode("signIn");
                        passwordInput.current?.focus();
                      }}
                    />
                  </FieldError>
                )}
              </VStack>
              <VStack gap={0.5}>
                <label htmlFor={`${ids}-password`}>
                  <Text as="span" type="supporting">Password</Text>
                </label>
                <HStack gap={1} align="center">
                  <input
                    ref={passwordInput}
                    id={`${ids}-password`}
                    className={stylex.props(styles.accountInput, styles.passwordInput).className}
                    type={passwordShown ? "text" : "password"}
                    autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={passwordError ? true : undefined}
                    aria-describedby={passwordDescribedBy || undefined}
                    required
                  />
                  <ToggleButton label="Show password" isPressed={passwordShown} onPressedChange={setPasswordShown} />
                </HStack>
                {/* An error takes the helper's place, so the rule shows once. */}
                {mode === "signUp" && !passwordError && (
                  <Text as="p" id={passwordHelpId} type="supporting">
                    At least 8 characters.
                  </Text>
                )}
                {passwordError && <FieldError id={passwordErrorId}>{passwordError}</FieldError>}
              </VStack>
              <HStack gap={1} align="center" xstyle={styles.accountControls}>
                <Button
                  label={mode === "signUp" ? "Create account" : "Sign in"}
                  variant="primary"
                  type="submit"
                  isDisabled={secondsLeft !== null}
                />
                <Button label="Close" variant="secondary" isDisabled={locked} onClick={collapse} />
              </HStack>
            </VStack>
          </form>
          {retryAfter !== null && secondsLeft !== null && (
            <>
              {/* The visible countdown changes every second, so only its first wording is announced. */}
              <VisuallyHidden>
                <Alert>Too many attempts. Try again in {waitText(retryAfter)}</Alert>
              </VisuallyHidden>
              <Text as="p" color="primary" xstyle={sharedStyles.error}>
                Too many attempts. Try again in {waitText(secondsLeft)}
              </Text>
            </>
          )}
        </VStack>
      )}
      {formError && <AccountError error={formError} />}
    </VStack>
  );
}
