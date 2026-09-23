import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../api/lessons";

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
  // True after the server rejected the session mid-use, until the next sign-in.
  expired: boolean;
  signIn: AuthActions;
  signUp: AuthActions;
  signOut: () => Promise<void>;
  expire: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [expired, setExpired] = useState(false);
  // Set while the last /me attempt failed on the network; an `online` event then retries it.
  const meNetworkFailed = useRef(false);

  useEffect(() => {
    let active = true;

    const restore = () => {
      meNetworkFailed.current = false;
      fetchMe()
        .then((currentUser) => {
          if (active) {
            setUser(currentUser);
            setError(null);
          }
        })
        .catch((requestError: unknown) => {
          if (active) {
            meNetworkFailed.current = !(requestError instanceof ApiError);
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
    };
    const retryOnline = () => {
      if (meNetworkFailed.current) {
        restore();
      }
    };

    restore();
    window.addEventListener("online", retryOnline);
    return () => {
      active = false;
      window.removeEventListener("online", retryOnline);
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
      meNetworkFailed.current = false;
      setExpired(false);
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

  const expire = useCallback(() => {
    setUser(null);
    setError(null);
    setExpired(true);
  }, []);

  return { user, loading, error, expired, signIn, signUp, signOut, expire };
}
