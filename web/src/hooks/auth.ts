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
  // Bumped when an explicit auth action sets the user; a /me started before it must not overwrite that.
  const generation = useRef(0);

  useEffect(() => {
    let active = true;

    const restore = () => {
      meNetworkFailed.current = false;
      const started = generation.current;
      fetchMe()
        .then((currentUser) => {
          if (active && started === generation.current) {
            setUser(currentUser);
            setError(null);
          }
        })
        .catch((requestError: unknown) => {
          if (active && started === generation.current) {
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
      const nextUser = await request(email, password);
      generation.current++;
      setUser(nextUser);
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
      generation.current++;
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
    generation.current++;
    setUser(null);
    setError(null);
    setExpired(true);
  }, []);

  return { user, loading, error, expired, signIn, signUp, signOut, expire };
}
