import { useEffect, type ReactNode } from "react";

import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { NotFoundError } from "../api/lessons";
import { sharedStyles } from "./styles";

// A polite region mounted before its content, so screen readers announce each result once.
export function Status({ children }: { children: ReactNode }) {
  return (
    <VStack gap={1} role="status">
      {children}
    </VStack>
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

const APP_TITLE = "Road to English";

// The page's one h1 names the current view and the document title, and takes focus when the user changes view.
export function ViewHeading({ children, takeFocus }: { children: string; takeFocus: () => boolean }) {
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
  const message = error instanceof NotFoundError ? "not found" : error.message;

  return (
    <Alert>
      Unable to load {subject}: {message}
    </Alert>
  );
}
