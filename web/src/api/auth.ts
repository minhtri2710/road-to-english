import { ApiError, request } from "./client";

export interface AuthUser {
  id: string;
  email: string;
}

function requestUser(
  path: "/signup" | "/login",
  email: string,
  password: string,
): Promise<AuthUser> {
  return request<AuthUser>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
}

export function signUp(email: string, password: string): Promise<AuthUser> {
  return requestUser("/signup", email, password);
}

export function signIn(email: string, password: string): Promise<AuthUser> {
  return requestUser("/login", email, password);
}

export function signOut(): Promise<void> {
  return request<void>("/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>("/me", {
      method: "GET",
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}
