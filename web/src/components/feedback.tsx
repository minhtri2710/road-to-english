import { Component, useEffect, type ReactNode } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { StyleXStyles } from "@stylexjs/stylex";

import { NotFoundError } from "../api/lessons";
import { tr, useT } from "../i18n";
import { sharedStyles } from "./styles";

// A polite region mounted before its content, so screen readers announce each result once.
export function Status({ children }: { children: ReactNode }) {
  return (
    <VStack gap={1} role="status">
      {children}
    </VStack>
  );
}

// A cloud with a slash: no connection to the server. Decorative beside the words that say so.
export function OfflineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 15.5h7.5a3.5 3.5 0 0 0 .9-6.9A5 5 0 0 0 5.2 7.4 4 4 0 0 0 6 15.5z" />
      <path d="M3 3l14 14" />
    </svg>
  );
}

// An error line announced as it appears.
export function Alert({ children }: { children: ReactNode }) {
  return (
    <Text as="p" role="alert" color="primary" xstyle={sharedStyles.error}>
      {children}
    </Text>
  );
}

export const APP_TITLE = "Road to English";

// The page's one h1 names the current view and the document title, and takes focus when the user changes view.
export function ViewHeading({ children, takeFocus, xstyle }: { children: string; takeFocus: () => boolean; xstyle?: StyleXStyles }) {
  useEffect(() => {
    document.title = `${children} · ${APP_TITLE}`;
    return () => {
      document.title = APP_TITLE;
    };
  }, [children]);

  return (
    <Heading
      level={1}
      tabIndex={-1}
      xstyle={xstyle}
      ref={(heading) => {
        if (heading && takeFocus()) {
          heading.focus();
        }
      }}
    >
      {children}
    </Heading>
  );
}

export function ErrorMessage({ error, subject }: { error: Error; subject: string }) {
  const t = useT();
  const message = error instanceof NotFoundError ? t("not found") : error.message;

  return (
    <Alert>
      {t("Unable to load {subject}: {message}", { subject: t(subject), message })}
    </Alert>
  );
}

// Replaces a crashed render with a way out; React still logs the error to the console.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <VStack gap={1}>
        <Heading level={1}>{tr("Something went wrong")}</Heading>
        <Text as="p">{tr("Your progress on this device is kept.")}</Text>
        <Button label={tr("Reload")} onClick={() => window.location.reload()} />
      </VStack>
    );
  }
}
