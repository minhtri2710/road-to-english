import { useEffect, useState } from "react";

import {
  fetchMe,
  signIn as requestSignIn,
  signOut as requestSignOut,
  signUp as requestSignUp,
  type AuthUser,
} from "../api/auth";

interface AuthActions {
  (email: string, password: string): Promise<void>;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: Error | null;
  signIn: AuthActions;
  signUp: AuthActions;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    fetchMe()
      .then((currentUser) => {
        if (active) {
          setUser(currentUser);
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError
              : new Error("Unable to restore account session"),
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const authenticate = async (
    request: (email: string, password: string) => Promise<AuthUser>,
    email: string,
    password: string,
  ) => {
    setError(null);
    try {
      setUser(await request(email, password));
    } catch (requestError: unknown) {
      const nextError =
        requestError instanceof Error
          ? requestError
          : new Error("Unable to authenticate");
      setError(nextError);
      throw nextError;
    }
  };

  const signIn = (email: string, password: string) =>
    authenticate(requestSignIn, email, password);
  const signUp = (email: string, password: string) =>
    authenticate(requestSignUp, email, password);
  const signOut = async () => {
    setError(null);
    try {
      await requestSignOut();
      setUser(null);
    } catch (requestError: unknown) {
      const nextError =
        requestError instanceof Error
          ? requestError
          : new Error("Unable to sign out");
      setError(nextError);
      throw nextError;
    }
  };

  return { user, loading, error, signIn, signUp, signOut };
}
